import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions } from '../../firebase'; 
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { signInWithCustomToken } from 'firebase/auth'; 
import { httpsCallable } from 'firebase/functions'; 
import '../../App.css';

const InceptionTab = lazy(() => import('./InceptionTab'));
const VisualAssemblyTab = lazy(() => import('./VisualAssemblyTab')); 
const NodeClusterTab = lazy(() => import('./NodeClusterTab')); 
const BOMTab = lazy(() => import('./BOMTab')); 
const LibraryTab = lazy(() => import('./LibraryTab')); 
const LibraryMassUpdateTab = lazy(() => import('./LibraryMassUpdateTab')); 
const InstructionsTab = lazy(() => import('./InstructionsTab'));
const PackagingTab = lazy(() => import('./PackagingTab'));
const CPQTab = lazy(() => import('./CPQTab'));
const ClientVisionTab = lazy(() => import('./ClientVisionTab')); 
const UPSShippingCalculator = lazy(() => import('./UPSShippingCalculator')); // 🚀 NEW IMPORT
const ExternalCoopTab = lazy(() => import('./ExternalCoopTab'));
const ProjectManagementTab = lazy(() => import('./ProjectManagementTab')); 
const AdminTab = lazy(() => import('./AdminTab')); 
const ERPPushPullTab = lazy(() => import('./ERPPushPullTab'));
const StockViewTab = lazy(() => import('./StockViewTab'));
const RTGDispatchTab = lazy(() => import('./RTGDispatchTab'));

const AssetGalleryTab = lazy(() => import('../Shared/AssetGalleryTab'));
const BatchImageProcessor = lazy(() => import('../Shared/BatchImageProcessor'));
const BatchTextureProcessor = lazy(() => import('../Shared/BatchTextureProcessor'));

const SharedMessaging = lazy(() => import('../Shared/SharedMessaging'));

const BRANDS = [
  { id: 'm2c', name: 'M2C Studio', focus: 'Lighting & Hardware', color: '#1A1A1A' }, 
  { id: 'uniquity', name: 'Uniquity', focus: 'Luxury Textiles', color: '#8C7D70' }, 
  { id: 'ce', name: 'Classical Elements', focus: 'Trimmings & Hardware', color: '#2C3E50' }, 
  { id: 'leyla', name: 'Leyla Gans LLC', focus: 'Fine Jewelry', color: '#C5A880' } 
];

// 🚀 UPDATED TABS ARRAY
const TABS = [
  '1. Inception & Validation', '1.5 Node Grouping', '2. Visual Assembly', '3. BOM Engine', '4. Master Library', '4.5 Mass Update',
  '5. Marketing', '6. Instructions', '7. Packaging', '8. CPQ Configurator',
  '9. Client Vision', '9.5 UPS Shipping', '10. External Co-Op', '10.5 Project Mgmt', '10.7 OS Comms', '11. System Admin', '12. ERP Push / Pull', '12.5 Stock View', '13. RTG Dispatch',
  '14. Asset Gallery', '14.5 Batch Processor', '14.6 Texture Processor', 'ERP_WRITE_BACK'
];

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

function HQ() { 
  const navigate = useNavigate(); 
  const [user, setUser] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [perms, setPerms] = useState({});
  const [activeBrand, setActiveBrand] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS[0]);

  const [globalCart, setGlobalCart] = useState(() => {
    try {
        const savedCart = localStorage.getItem('hq_global_cart');
        return savedCart ? JSON.parse(savedCart) : [];
    } catch (e) {
        return [];
    }
  });

  useEffect(() => {
      localStorage.setItem('hq_global_cart', JSON.stringify(globalCart));
  }, [globalCart]);

  useEffect(() => {
    const savedBrandId = localStorage.getItem('m2c_brand');
    if (savedBrandId) {
      const brand = BRANDS.find(b => b.id === savedBrandId);
      if (brand) setActiveBrand(brand);
    }
  }, []);

  useEffect(() => {
    const handleTabNavigation = (e) => {
      if (e.detail === 'VISION') setActiveTab('9. Client Vision');
      if (e.detail === 'CPQ') setActiveTab('8. CPQ Configurator');
    };
    window.addEventListener('NAVIGATE_TAB', handleTabNavigation);
    return () => window.removeEventListener('NAVIGATE_TAB', handleTabNavigation);
  }, []);

  const attemptLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;
    
    try {
      const authenticatePin = httpsCallable(functions, 'authenticatePin');
      const result = await authenticatePin({ pin: pinInput });
      
      const { token, user: userData } = result.data;

      await signInWithCustomToken(auth, token);

      if (pinInput === "1032") {
        setUser(userData);
        setPerms({ admin: TABS });
      } else {
        const pSnap = await getDoc(doc(db, "hq_config", "permissions"));
        setPerms(pSnap.exists() ? pSnap.data() : {});
        setUser(userData);
      }
      
    } catch (err) { 
      console.error(err); 
      alert("Authentication failed: " + (err.message || "Invalid PIN")); 
      setPinInput(""); 
    }
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
    auth.signOut(); 
  };

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.paper, fontFamily: theme.sans }}>
        <div style={{ background: '#fff', padding: '50px 40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '400px', textAlign: 'center' }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>
            Authorization Required
          </span>
          <h1 style={{ fontFamily: theme.serif, margin: '0 0 30px 0', fontSize: '2.2rem', fontWeight: 500, color: theme.ink }}>Enterprise PLM</h1>
          <form onSubmit={attemptLogin}>
            <input 
              type="password" 
              value={pinInput} 
              onChange={e => setPinInput(e.target.value)} 
              autoFocus 
              placeholder="ENTER PIN" 
              maxLength="4" 
              style={{ width: '100%', padding: '15px', border: `1px solid ${theme.line}`, marginBottom: '20px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '10px', fontFamily: theme.mono, color: theme.ink, outline: 'none' }} 
            />
            <button 
              type="submit" 
              style={{ width: '100%', padding: '15px', background: theme.ink, color: '#fff', fontWeight: 400, fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', transition: 'background 0.2s' }}
              onMouseOver={(e) => e.currentTarget.style.background = theme.brass}
              onMouseOut={(e) => e.currentTarget.style.background = theme.ink}
            >
              Authenticate
            </button>
          </form>
          <button 
            onClick={() => navigate('/')} 
            style={{ marginTop: '30px', background: 'none', border: 'none', color: theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${theme.brass}`, paddingBottom: '2px' }}
          >
            Return to Hub
          </button>
        </div>
      </div>
    );
  }

  if (user && !activeBrand) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.paper, fontFamily: theme.sans }}>
        <div style={{ background: '#fff', padding: '50px 40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '450px', textAlign: 'center' }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>
            Welcome, {user.name}
          </span>
          <h1 style={{ fontFamily: theme.serif, margin: '0 0 30px 0', fontSize: '2.2rem', fontWeight: 500, color: theme.ink }}>Select Division</h1>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {BRANDS.map(brand => (
              <button 
                key={brand.id}
                onClick={() => selectBrand(brand)}
                style={{ padding: '20px', background: '#fff', border: `1px solid ${theme.line}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: 'all 0.3s ease' }}
                onMouseOver={(e) => { 
                  e.currentTarget.style.borderColor = brand.color; 
                  e.currentTarget.style.boxShadow = `0 4px 12px rgba(0,0,0,0.05)`;
                }}
                onMouseOut={(e) => { 
                  e.currentTarget.style.borderColor = theme.line;
                  e.currentTarget.style.boxShadow = `none`;
                }}
              >
                <span style={{ fontFamily: theme.sans, fontSize: '1rem', fontWeight: 500, color: theme.ink, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{brand.name}</span>
                <span style={{ display: 'block', fontFamily: theme.serif, fontSize: '0.9rem', color: theme.inkSoft, fontStyle: 'italic', marginTop: '4px' }}>{brand.focus}</span>
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
    <div className="App" style={{ minHeight: '100vh', backgroundColor: theme.paper, fontFamily: theme.sans, display: 'flex', flexDirection: 'column' }}>
      
      <header style={{ backgroundColor: '#fff', borderTop: `4px solid ${activeBrand.color}`, borderBottom: `1px solid ${theme.line}`, padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontFamily: theme.serif, margin: 0, fontSize: '1.6rem', fontWeight: 500, color: theme.ink, letterSpacing: '0.05em' }}>
            {activeBrand.name.toUpperCase()}
          </h1>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>
            Product Lifecycle Management
          </span>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '24px' }}>
          <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft }}>
            Operator: <strong style={{ color: theme.ink, fontWeight: 500 }}>{user.name}</strong>
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={handleLogout} 
              style={{ padding: '8px 16px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, transition: 'all 0.2s' }}
              onMouseOver={(e) => { e.currentTarget.style.color = theme.ink; e.currentTarget.style.borderColor = theme.ink; }}
              onMouseOut={(e) => { e.currentTarget.style.color = theme.inkSoft; e.currentTarget.style.borderColor = theme.line; }}
            >
              Switch Division
            </button>
            <button 
              onClick={() => navigate('/')} 
              style={{ padding: '8px 16px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', background: theme.ink, color: '#fff', border: 'none', transition: 'background 0.2s' }}
              onMouseOver={(e) => e.currentTarget.style.background = theme.brass}
              onMouseOut={(e) => e.currentTarget.style.background = theme.ink}
            >
              Return to Hub
            </button>
          </div>
        </div>
      </header>

      <nav style={{ display: 'flex', backgroundColor: theme.paper, borderBottom: `1px solid ${theme.line}`, overflowX: 'auto', padding: '0 20px' }}>
        {TABS.filter(t => myTabs.includes(t) && t !== 'ERP_WRITE_BACK').map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                whiteSpace: 'nowrap', padding: '16px 20px', cursor: 'pointer', border: 'none', background: 'transparent',
                borderBottom: isActive ? `2px solid ${activeBrand.color}` : '2px solid transparent',
                color: isActive ? theme.ink : theme.inkSoft,
                fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase',
                opacity: isActive ? 1 : 0.7, transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => { if (!isActive) e.currentTarget.style.opacity = 1; }}
              onMouseOut={(e) => { if (!isActive) e.currentTarget.style.opacity = 0.7; }}
            >
              {tab}
            </button>
          );
        })}
      </nav>

      <main style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ backgroundColor: '#fff', border: `1px solid ${theme.line}`, flex: 1, overflow: 'hidden', position: 'relative', padding: '30px', borderRadius: '2px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
          
          <Suspense fallback={
            <div style={{ display: 'flex', height: '100%', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: '20px' }}>
              <div style={{ fontFamily: theme.serif, fontSize: '2rem', color: theme.brass, fontStyle: 'italic' }}>Loading Module...</div>
            </div>
          }>
            {/* 🚀 The array indices have been safely shifted here */}
            {activeTab === TABS[0] && <InceptionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[1] && <NodeClusterTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[2] && <VisualAssemblyTab currentUser={user.name} activeBrand={activeBrand.id} onProceed={() => setActiveTab(TABS[3])} />}
            {activeTab === TABS[3] && <BOMTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[4] && <LibraryTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[5] && <LibraryMassUpdateTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[7] && <InstructionsTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[8] && <PackagingTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[9] && <CPQTab currentUser={user.name} activeBrand={activeBrand.id} cart={globalCart} setCart={setGlobalCart} />}
            {activeTab === TABS[10] && <ClientVisionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[11] && <UPSShippingCalculator currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[12] && <ExternalCoopTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[13] && <ProjectManagementTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[14] && <SharedMessaging currentUser={user.name} currentApp="HQ" writeLog={null} />}
            {activeTab === TABS[15] && <AdminTab currentUser={user.name} activeBrand={activeBrand.id} perms={perms} setPerms={setPerms} TABS={TABS} />}
            {activeTab === TABS[16] && <ERPPushPullTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[17] && <StockViewTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[18] && <RTGDispatchTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[19] && <AssetGalleryTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[20] && <BatchImageProcessor currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === TABS[21] && <BatchTextureProcessor currentUser={user.name} />}
          </Suspense>

        </div>
      </main>
    </div>
  );
}

export default HQ;