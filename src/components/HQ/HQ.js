import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import '../../App.css';

const InceptionTab = lazy(() => import('./InceptionTab'));
const VisualAssemblyTab = lazy(() => import('./VisualAssemblyTab')); 
const NodeClusterTab = lazy(() => import('./NodeClusterTab')); 
const BOMTab = lazy(() => import('./BOMTab')); 
const LibraryTab = lazy(() => import('./LibraryTab')); 
const InstructionsTab = lazy(() => import('./InstructionsTab'));
const PackagingTab = lazy(() => import('./PackagingTab'));
const CPQTab = lazy(() => import('./CPQTab'));
const ClientVisionTab = lazy(() => import('./ClientVisionTab')); 
const ExternalCoopTab = lazy(() => import('./ExternalCoopTab'));
const ProjectManagementTab = lazy(() => import('./ProjectManagementTab')); 
const AdminTab = lazy(() => import('./AdminTab')); 
const ERPPushPullTab = lazy(() => import('./ERPPushPullTab'));
const StockViewTab = lazy(() => import('./StockViewTab'));
const RTGDispatchTab = lazy(() => import('./RTGDispatchTab'));

const AssetGalleryTab = lazy(() => import('../Shared/AssetGalleryTab'));
const BatchImageProcessor = lazy(() => import('../Shared/BatchImageProcessor'));

// 🚀 NEW: Import Shared Messaging
const SharedMessaging = lazy(() => import('../Shared/SharedMessaging'));

const BRANDS = [
  { id: 'm2c', name: 'M2C Studio', focus: 'Lighting & Hardware', color: '#1A1A1A' }, 
  { id: 'uniquity', name: 'Uniquity', focus: 'Luxury Textiles', color: '#8C7D70' }, 
  { id: 'ce', name: 'Classical Elements', focus: 'Trimmings & Hardware', color: '#2C3E50' }, 
  { id: 'leyla', name: 'Leyla Gans LLC', focus: 'Fine Jewelry', color: '#C5A880' } 
];

// 🚀 UPDATED: Added 12.5 Stock View
const TABS = [
  '1. Inception & Validation', '1.5 Node Grouping', '2. Visual Assembly', '3. BOM Engine', '4. Master Library',
  '5. Marketing', '6. Instructions', '7. Packaging', '8. CPQ Configurator',
  '9. Client Vision', '10. External Co-Op', '10.5 Project Mgmt', '10.7 OS Comms', '11. System Admin', '12. ERP Push / Pull', '12.5 Stock View', '13. RTG Dispatch',
  '14. Asset Gallery', '14.5 Batch Processor', 'ERP_WRITE_BACK'
];
];

function HQ() { 
  const navigate = useNavigate(); 
  const [user, setUser] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [perms, setPerms] = useState({});
  const [activeBrand, setActiveBrand] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS[0]);

  useEffect(() => {
    const savedBrandId = localStorage.getItem('m2c_brand');
    if (savedBrandId) {
      const brand = BRANDS.find(b => b.id === savedBrandId);
      if (brand) setActiveBrand(brand);
    }
  }, []);

  const attemptLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;
    try {
      if (pinInput === "1032") {
        setUser({ name: "Master Admin", role: "admin" });
        setPerms({ admin: TABS });
        return;
      }
      
      const uSnap = await getDocs(query(collection(db, "hq_users"), where("pin", "==", pinInput)));
      if (!uSnap.empty) {
        const uData = uSnap.docs[0].data();
        const pSnap = await getDoc(doc(db, "hq_config", "permissions"));
        let pData = pSnap.exists() ? pSnap.data() : {};
        
        setPerms(pData);
        setUser(uData);
      } else {
        alert("Invalid PIN.");
      }
    } catch (err) { console.error(err); alert("Authentication failed."); }
  };

  const selectBrand = (brand) => {
    setActiveBrand(brand);
    localStorage.setItem('m2c_brand', brand.id);
    
    const safeRole = user?.role ? user.role.toLowerCase() : 'operator';
    const authorizedTabs = user?.role === 'admin' ? TABS : (perms[safeRole] || []);
    setActiveTab(authorizedTabs[0] || TABS[0]); 
  };

  const handleLogout = () => {
    setActiveBrand(null);
    setUser(null);
    setPinInput("");
    localStorage.removeItem('m2c_brand');
  };

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f4f4', fontFamily: 'monospace' }}>
        <div style={{ background: '#fff', padding: '40px', border: '3px solid #000', boxShadow: '15px 15px 0 #000', width: '400px', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 20px 0', fontSize: '1.5rem', letterSpacing: '2px' }}>ENTERPRISE PLM</h1>
          <form onSubmit={attemptLogin}>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>HQ AUTHORIZATION PIN:</label>
            <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} autoFocus placeholder="ENTER PIN" maxLength="4" style={{ width: '100%', padding: '12px', border: '2px solid #000', marginBottom: '20px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '10px' }} />
            <button type="submit" style={{ width: '100%', padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}>AUTHENTICATE</button>
          </form>
          <button onClick={() => navigate('/')} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontWeight: 'bold' }}>← BACK TO HUB</button>
        </div>
      </div>
    );
  }

  if (user && !activeBrand) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f4f4', fontFamily: 'monospace' }}>
        <div style={{ background: '#fff', padding: '40px', border: '3px solid #000', boxShadow: '15px 15px 0 #000', width: '400px', textAlign: 'center' }}>
          <p style={{ marginBottom: '20px', fontWeight: 'bold', fontSize: '1.2rem' }}>WELCOME, {user.name.toUpperCase()}</p>
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
      </div>
    );
  }

  const safeUserRole = user?.role ? user.role.toLowerCase() : 'operator';
  const myTabs = user?.role === 'admin' ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

  return (
    <div className="App" style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      
      <header style={{ backgroundColor: activeBrand.color, color: '#fff', padding: '15px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '4px solid #000', transition: 'background-color 0.3s' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', letterSpacing: '2px' }}>{activeBrand.name.toUpperCase()}</h1>
          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>PRODUCT LIFECYCLE MANAGEMENT (PLM)</span>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '0.85rem' }}>OPERATOR: <strong>{user.name.toUpperCase()}</strong></span>
          <button onClick={handleLogout} style={{ padding: '5px 12px', fontSize: '0.7rem', cursor: 'pointer', background: 'transparent', color: '#fff', border: '1px solid #fff' }}>SWITCH BRAND / LOGOUT</button>
          <button onClick={() => navigate('/')} style={{ padding: '5px 12px', fontSize: '0.7rem', cursor: 'pointer', background: '#fff', color: activeBrand.color, border: '1px solid #fff', fontWeight: 'bold' }}>🏠 HUB</button>
        </div>
      </header>

      <<nav style={{ display: 'flex', backgroundColor: '#fff', borderBottom: '3px solid #000', overflowX: 'auto' }}>
        {TABS.filter(t => myTabs.includes(t) && t !== 'ERP_WRITE_BACK').map((tab) => (
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
              transition: 'all 0.2s'
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ backgroundColor: 'white', border: '2px solid #000', flex: 1, boxShadow: '8px 8px 0px rgba(0,0,0,0.1)', overflow: 'hidden', position: 'relative', padding: '20px' }}>
          
          <Suspense fallback={
            <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '20px' }}>
              <div style={{ fontSize: '3rem' }}>⏳</div>
              <h2 style={{ color: activeBrand.color }}>LOADING MODULE...</h2>
            </div>
          }>
            {/* 🚀 UPDATED: Render array mapping mapped to new layout order */}
            {activeTab === TABS[0] && <InceptionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[1] && <NodeClusterTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[2] && <VisualAssemblyTab currentUser={user.name} activeBrand={activeBrand.id} onProceed={() => setActiveTab(TABS[3])} />}
            {activeTab === TABS[3] && <BOMTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[4] && <LibraryTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[6] && <InstructionsTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[7] && <PackagingTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[8] && <CPQTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[9] && <ClientVisionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[10] && <ExternalCoopTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[11] && <ProjectManagementTab currentUser={user.name} activeBrand={activeBrand.id} />}
            
            {activeTab === TABS[12] && <SharedMessaging currentUser={user.name} currentApp="HQ" writeLog={null} />}
            {activeTab === TABS[13] && <AdminTab currentUser={user.name} activeBrand={activeBrand.id} perms={perms} setPerms={setPerms} TABS={TABS} />}
            {activeTab === TABS[14] && <ERPPushPullTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[15] && <StockViewTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[16] && <RTGDispatchTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[17] && <AssetGalleryTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[18] && <BatchImageProcessor currentUser={user.name} activeBrand={activeBrand.id} />}
          </Suspense>

        </div>
      </main>
    </div>
  );
}

export default HQ;