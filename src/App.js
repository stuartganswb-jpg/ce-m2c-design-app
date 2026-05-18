import React, { useState, useEffect } from 'react';
import './App.css';

// Component Imports
import InceptionTab from './components/InceptionTab';
import VisualAssemblyTab from './components/VisualAssemblyTab'; 
import BOMTab from './components/BOMTab'; 
import LibraryTab from './components/LibraryTab'; 
import InstructionsTab from './components/InstructionsTab';
import PackagingTab from './components/PackagingTab'; // <-- NEW IMPORT
import CPQTab from './components/CPQTab';
import ClientVisionTab from './components/ClientVisionTab'; 
import ExternalCoopTab from './components/ExternalCoopTab';
import AdminTab from './components/AdminTab'; 
import ERPPushPullTab from './components/ERPPushPullTab'; 

const BRANDS = [
  { id: 'm2c', name: 'M2C Studio', focus: 'Lighting & Hardware', color: '#000000' },
  { id: 'uniquity', name: 'Uniquity', focus: 'Luxury Textiles', color: '#8b0000' }, 
  { id: 'ce', name: 'Classical Elements', focus: 'Trimmings & Hardware', color: '#004080' }, 
  { id: 'leyla', name: 'Leyla Gans LLC', focus: 'Fine Jewelry', color: '#d4af37' } 
];

const TABS = [
  '1. Inception & Validation',   // TABS[0]
  '2. Visual Assembly',          // TABS[1]
  '3. BOM Engine',               // TABS[2]
  '4. Master Library',           // TABS[3]
  '5. Marketing',                // TABS[4]
  '6. Instructions',             // TABS[5]
  '7. Packaging',                // TABS[6] <-- FULLY INTEGRATED
  '8. CPQ Configurator',         // TABS[7] 
  '9. Client Vision',            // TABS[8]
  '10. External Co-Op',          // TABS[9] 
  '11. System Admin',            // TABS[10]
  '12. ERP Push / Pull'          // TABS[11] 
];

function App() {
  const [userName, setUserName] = useState("");
  const [activeBrand, setActiveBrand] = useState(null);
  
  // Set default tab to CPQ (TABS[7]) or Inception (TABS[0])
  const [activeTab, setActiveTab] = useState(TABS[0]);

  useEffect(() => {
    const savedUser = localStorage.getItem('m2c_user');
    const savedBrandId = localStorage.getItem('m2c_brand');
    if (savedUser) setUserName(savedUser);
    if (savedBrandId) {
      const brand = BRANDS.find(b => b.id === savedBrandId);
      if (brand) setActiveBrand(brand);
    }
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    const name = e.target.elements.nameInput.value;
    if (name) {
      setUserName(name);
      localStorage.setItem('m2c_user', name);
    }
  };

  const selectBrand = (brand) => {
    setActiveBrand(brand);
    localStorage.setItem('m2c_brand', brand.id);
    setActiveTab(TABS[0]); 
  };

  const handleLogout = () => {
    setActiveBrand(null);
    localStorage.removeItem('m2c_brand');
  };

  if (!userName || !activeBrand) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f4f4', fontFamily: 'monospace' }}>
        <div style={{ background: '#fff', padding: '40px', border: '3px solid #000', boxShadow: '15px 15px 0 #000', width: '400px', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', letterSpacing: '2px' }}>ENTERPRISE PLM</h1>
          {!userName ? (
            <form onSubmit={handleLogin}>
              <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>OPERATOR ID:</label>
              <input name="nameInput" autoFocus placeholder="Enter your name..." style={{ width: '100%', padding: '12px', border: '2px solid #000', marginBottom: '20px', boxSizing: 'border-box', textTransform: 'uppercase' }} />
              <button type="submit" style={{ width: '100%', padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>AUTHENTICATE</button>
            </form>
          ) : (
            <div>
              <p style={{ marginBottom: '20px', fontWeight: 'bold' }}>WELCOME, {userName.toUpperCase()}</p>
              <p style={{ fontSize: '0.8rem', marginBottom: '15px' }}>SELECT OPERATING DIVISION:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {BRANDS.map(brand => (
                  <button 
                    key={brand.id}
                    onClick={() => selectBrand(brand)}
                    style={{ padding: '15px', background: '#fff', border: `2px solid ${brand.color}`, color: brand.color, fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase', transition: '0.2s' }}
                    onMouseOver={(e) => { e.target.style.background = brand.color; e.target.style.color = '#fff'; }}
                    onMouseOut={(e) => { e.target.style.background = '#fff'; e.target.style.color = brand.color; }}
                  >
                    {brand.name} <span style={{ display: 'block', fontSize: '0.6rem', marginTop: '5px' }}>{brand.focus}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="App" style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      
      <header style={{ backgroundColor: activeBrand.color, color: '#fff', padding: '15px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '4px solid #000' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', letterSpacing: '2px' }}>{activeBrand.name.toUpperCase()}</h1>
          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>PRODUCT LIFECYCLE MANAGEMENT (PLM)</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '0.85rem', marginRight: '15px' }}>OPERATOR: <strong>{userName.toUpperCase()}</strong></span>
          <button onClick={handleLogout} style={{ padding: '5px 12px', fontSize: '0.7rem', cursor: 'pointer', background: 'transparent', color: '#fff', border: '1px solid #fff' }}>SWITCH BRAND</button>
        </div>
      </header>

      <nav style={{ display: 'flex', backgroundColor: '#fff', borderBottom: '3px solid #000', overflowX: 'auto' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, minWidth: '120px', padding: '12px 5px', cursor: 'pointer', border: 'none', borderRight: '1px solid #ccc',
              borderBottom: activeTab === tab ? `4px solid ${activeBrand.color}` : '4px solid transparent',
              background: activeTab === tab ? '#f4f4f4' : 'transparent',
              color: activeTab === tab ? activeBrand.color : '#333',
              fontWeight: activeTab === tab ? 'bold' : 'normal',
              textTransform: 'uppercase', fontSize: '0.65rem',
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ backgroundColor: 'white', border: '2px solid #000', flex: 1, boxShadow: '8px 8px 0px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
          
          {/* Active Tab Routing */}
          {activeTab === TABS[0] && <InceptionTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[1] && <VisualAssemblyTab currentUser={userName} activeBrand={activeBrand.id} onProceed={() => setActiveTab(TABS[2])} />}
          {activeTab === TABS[2] && <BOMTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[3] && <LibraryTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[5] && <InstructionsTab currentUser={userName} activeBrand={activeBrand.id} />}
          
          {/* Packaging Module */}
          {activeTab === TABS[6] && <PackagingTab currentUser={userName} activeBrand={activeBrand.id} />}
          
          {/* Master Workflow Pipeline */}
          {activeTab === TABS[7] && <CPQTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[8] && <ClientVisionTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[9] && <ExternalCoopTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[10] && <AdminTab currentUser={userName} activeBrand={activeBrand.id} />}
          {activeTab === TABS[11] && <ERPPushPullTab currentUser={userName} activeBrand={activeBrand.id} />}

          {/* Under Construction Fallback */}
          {![TABS[0], TABS[1], TABS[2], TABS[3], TABS[5], TABS[6], TABS[7], TABS[8], TABS[9], TABS[10], TABS[11]].includes(activeTab) && (
            <div style={{ padding: '60px', textAlign: 'center', color: '#666' }}>
              <div style={{ fontSize: '3rem', marginBottom: '20px', opacity: 0.5 }}>🚧</div>
              <h2>{activeTab.toUpperCase()} MODULE</h2>
              <p>Under construction for the {activeBrand.name} workflow.</p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;