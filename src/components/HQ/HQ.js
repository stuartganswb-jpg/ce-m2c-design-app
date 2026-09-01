import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions, getOuterIdToken } from '../../firebase'; 
import { collection, query, where, getDocs, doc, getDoc, addDoc, serverTimestamp, onSnapshot, orderBy, limit, updateDoc } from "firebase/firestore";
import { signInWithCustomToken } from 'firebase/auth'; 
import { httpsCallable } from 'firebase/functions'; 
import '../../App.css';

const InceptionTab = lazy(() => import('./InceptionTab'));
const VisualAssemblyTab = lazy(() => import('./VisualAssemblyTab')); 
const NodeClusterTab = lazy(() => import('./NodeClusterTab')); 
const BOMTab = lazy(() => import('./BOMTab')); 
const LibraryTab = lazy(() => import('./LibraryTab')); 
const LibraryMassUpdateTab = lazy(() => import('./LibraryMassUpdateTab')); 
const CustomerCollectionsTab = lazy(() => import('./CustomerCollectionsTab'));
const InstructionsTab = lazy(() => import('./InstructionsTab'));
const ToolsSpecsTab = lazy(() => import('./ToolsSpecsTab'));
const PackagingTab = lazy(() => import('./PackagingTab'));
const CPQTab = lazy(() => import('./CPQTab'));
const ClientVisionTab = lazy(() => import('./ClientVisionTab')); 
const UPSShippingCalculator = lazy(() => import('./UPSShippingCalculator')); 
const ExternalCoopTab = lazy(() => import('./ExternalCoopTab'));
const ProjectManagementTab = lazy(() => import('./ProjectManagementTab')); 
const AdminTab = lazy(() => import('./AdminTab')); 
const NetSuiteSyncTab = lazy(() => import('./NetSuiteSyncTab')); 
const ERPPushPullTab = lazy(() => import('./ERPPushPullTab'));
const StockViewTab = lazy(() => import('./StockViewTab'));
const ErpMappingAudit = lazy(() => import('./ErpMappingAudit'));
const RTGDispatchTab = lazy(() => import('./RTGDispatchTab'));
const QuickShipTab = lazy(() => import('./QuickShipTab'));
const AssemblyBuilderTab = lazy(() => import('./AssemblyBuilderTab'));

const AssetGalleryTab = lazy(() => import('../Shared/AssetGalleryTab'));
const AppImprovementTab = lazy(() => import('../Shared/AppImprovementTab'));
const UserGuideTab = lazy(() => import('./UserGuideTab'));
const BatchImageProcessor = lazy(() => import('../Shared/BatchImageProcessor'));
const BatchTextureProcessor = lazy(() => import('../Shared/BatchTextureProcessor'));
const SharedMessaging = lazy(() => import('../Shared/SharedMessaging'));

const BRANDS = [
  { id: 'm2c', name: 'M2C Studio', focus: 'Lighting & Hardware', color: '#1A1A1A' }, 
  { id: 'uniquity', name: 'Uniquity', focus: 'Luxury Textiles', color: '#8C7D70' }, 
  { id: 'ce', name: 'Classical Elements', focus: 'Trimmings & Hardware', color: '#2C3E50' }, 
  { id: 'leyla', name: 'Leyla Gans LLC', focus: 'Fine Jewelry', color: '#C5A880' } 
];

// Display-only label overrides. Keys stay as the canonical tab id (used in role permissions and
// activeTab logic) — only the visible button text changes.
const TAB_LABELS = {
  '1. Inception & Validation': '1. Product & Project Inception',
  // Tab 7 outgrew its name (Stuart 2026-08-22): it started as the stocked-goods counter and is
  // becoming where an order is entered — stock, to-be-finished, kits, fees. The KEY stays
  // '7. Quick Ship' because every role's permissions in hq_config/permissions are stored against
  // it; renaming the key would quietly revoke the tab for everyone who has it.
  '7. Quick Ship': '7. Order Entry',
};

const TABS = [
  '1. Inception & Validation', '1.5 Node Grouping', '1.6 Assembly Builder', '2. Visual Assembly', '3. BOM Engine', '4. Master Library', '4.5 Mass Update', '4.6 Customer Collections',
  '5. Marketing', '6. Instructions', '6.5 Tools, Specs & FAQs', '7. Quick Ship', '8. CPQ Configurator',
  '9. Client Vision', '9.5 UPS Shipping', '10. External Co-Op', '10.5 Project Mgmt', '10.7 OS Comms', '11. System Admin', '11.1 NetSuite Sync', '11.2 ERP Mapping Audit', '12. ERP Push / Pull', '12.5 Stock View', '13. RTG Dispatch',
  '14. Asset Gallery', '14.5 Batch Processor', '14.6 Texture Processor', '15. Packaging', 'App Imp.', 'User Guide', 'ERP_WRITE_BACK'
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

// 🚀 UNIVERSAL HQ LOGGING FUNCTION
export const logHqAction = async (userName, tabName, actionMessage) => {
    try {
        await addDoc(collection(db, "hq_logs"), {
            t: serverTimestamp(),
            u: userName,
            tab: tabName,
            action: actionMessage,
            app: "HQ"
        });
    } catch (e) {
        console.error("Failed to write HQ log", e);
    }
};

function HQ() { 
  const navigate = useNavigate(); 
  const [user, setUser] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [perms, setPerms] = useState({});
  const [activeBrand, setActiveBrand] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS[0]);

  // Tab notification badges: unread OS-Comms messages (addressed to me) + unseen Inception pins
  // (brand-wide, shown to anyone with Inception access). Seen-state for pins is per-user localStorage.
  const [unreadMsgs, setUnreadMsgs] = useState([]); // {id, readBy} addressed to me + still unread
  const [pinList, setPinList] = useState([]);        // {id, user, seenBy} across the brand's assemblies

  // NEW: State to hold an item ID we want to immediately open in the Master Library
  const [libraryFocusItemId, setLibraryFocusItemId] = useState(null);

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

  // OS-Comms badge: global_messages addressed to me (or ALL broadcasts) that I didn't send and
  // haven't read. Kept as a list so opening the tab can mark them all read.
  useEffect(() => {
    const me = user?.name;
    if (!me) { setUnreadMsgs([]); return; }
    const q = query(collection(db, "global_messages"), orderBy("t", "desc"), limit(100));
    const unsub = onSnapshot(q, snap => {
      const unread = [];
      snap.docs.forEach(d => {
        const m = d.data();
        const forMe = m.target === me || m.target === 'ALL';
        if (forMe && m.sender !== me && !(m.readBy || []).includes(me)) unread.push({ id: d.id, readBy: m.readBy || [] });
      });
      setUnreadMsgs(unread);
    }, err => console.warn('OS-Comms badge listen failed', err));
    return () => unsub();
  }, [user]);

  // Opening the OS Comms tab auto-marks everything addressed to me as read → clears the asterisk.
  useEffect(() => {
    const me = user?.name;
    if (activeTab !== '10.7 OS Comms' || !me || !unreadMsgs.length) return;
    unreadMsgs.forEach(m => updateDoc(doc(db, "global_messages", m.id), { readBy: [...(m.readBy || []), me] }).catch(e => console.warn('auto mark-read failed', e)));
  }, [activeTab, unreadMsgs, user]);

  // Inception badge: every spatial-callout (pin) across the brand's assemblies, with its author
  // (`user`) and `seenBy` list. The asterisk shows to anyone-but-the-author until they've SEEN it.
  // seenBy is stamped (in InceptionTab) only when they open that assembly's board — so it syncs
  // across devices and stays lit until the actual board is viewed, not just the tab.
  useEffect(() => {
    if (!activeBrand) { setPinList([]); return; }
    const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand.id));
    const unsub = onSnapshot(q, snap => {
      const pins = [];
      snap.docs.forEach(d => (d.data().spatialCallouts || []).forEach(c => { if (c && c.id) pins.push({ id: String(c.id), user: c.user || '', seenBy: c.seenBy || [] }); }));
      setPinList(pins);
    }, err => console.warn('Inception pin badge listen failed', err));
    return () => unsub();
  }, [activeBrand]);

  const currentUserName = user?.name;
  const unseenPins = useMemo(() => {
    if (!currentUserName || !pinList.length) return false;
    return pinList.some(p => p.user !== currentUserName && !(p.seenBy || []).includes(currentUserName));
  }, [pinList, currentUserName]);

  useEffect(() => {
    const handleTabNavigation = (e) => {
      if (e.detail === 'VISION') setActiveTab('9. Client Vision');
      if (e.detail === 'CPQ') setActiveTab('8. CPQ Configurator');
    };
    // Reopen-a-quote (Shared/reopenQuote.js, fired from CRM / ERP hub): swap the finalized
    // quote's cart snapshot into the global cart, lock the session to its job id, stash the
    // job context for CPQTab to restore on mount, and jump to the configurator.
    const handleReopenQuote = (e) => {
      const { cartItems, session } = e.detail || {};
      if (!Array.isArray(cartItems) || !cartItems.length || !session?.jobId) return;
      setGlobalCart(cartItems);
      localStorage.setItem('hq_active_quote_session', session.jobId);
      localStorage.setItem('hq_reopen_quote', JSON.stringify(session));
      setActiveTab('8. CPQ Configurator');
    };
    // Reopen-in-Vision (Shared/reopenQuote.js): restore the quote's Vision session (customer /
    // job / quote id, consumed by ClientVisionTab on mount) and jump to the Vision board —
    // dimensions, bracket placement, and shop notes are edited there.
    const handleReopenVision = (e) => {
      const s = e.detail?.session;
      if (!s?.jobId) return;
      localStorage.setItem('hq_active_quote_session', s.jobId);
      localStorage.setItem('hq_vision_reopen', JSON.stringify(s));
      setActiveTab('9. Client Vision');
    };
    // Reopen an Order Entry SALES ORDER for editing (CRM ✎ Edit, 2026-08-30): tab 7 rebuilds
    // the cart from the SO's lines; pushing the edited cart supersedes (closes) the original.
    const handleReopenSo = (e) => {
      const soId = e.detail?.soId;
      if (!soId) return;
      localStorage.setItem('hq_reopen_qs_so', JSON.stringify({ soId, at: Date.now() }));
      setActiveTab('7. Quick Ship');
    };
    // Reopen an Order Entry QUOTE (CRM → Reopen Order Entry, 2026-08-31): tab 7 restores the
    // stored cart; saving supersedes the original quote.
    const handleReopenQsQuote = (e) => {
      const jobId = e.detail?.jobId;
      if (!jobId) return;
      localStorage.setItem('hq_reopen_qs_quote', JSON.stringify({ jobId, at: Date.now() }));
      setActiveTab('7. Quick Ship');
    };
    window.addEventListener('REOPEN_QUOTE_IN_ORDERENTRY', handleReopenQsQuote);
    window.addEventListener('REOPEN_SO_IN_ORDERENTRY', handleReopenSo);
    window.addEventListener('NAVIGATE_TAB', handleTabNavigation);
    window.addEventListener('REOPEN_QUOTE_IN_CPQ', handleReopenQuote);
    window.addEventListener('REOPEN_QUOTE_IN_VISION', handleReopenVision);
    return () => {
      window.removeEventListener('REOPEN_QUOTE_IN_ORDERENTRY', handleReopenQsQuote);
      window.removeEventListener('REOPEN_SO_IN_ORDERENTRY', handleReopenSo);
      window.removeEventListener('NAVIGATE_TAB', handleTabNavigation);
      window.removeEventListener('REOPEN_QUOTE_IN_CPQ', handleReopenQuote);
      window.removeEventListener('REOPEN_QUOTE_IN_VISION', handleReopenVision);
    };
  }, []);

  const attemptLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;
    
    try {
      const authenticatePin = httpsCallable(functions, 'authenticatePin');
      const result = await authenticatePin({ pin: pinInput, outerToken: await getOuterIdToken() });
      
      const { token, user: userData } = result.data;

      await signInWithCustomToken(auth, token);

      // All-tabs access is granted at render time to the admin/superadmin role claim (see myTabs
      // below); there is no client-side master PIN. Everyone loads their configured permissions here.
      const pSnap = await getDoc(doc(db, "hq_config", "permissions"));
      setPerms(pSnap.exists() ? pSnap.data() : {});
      setUser(userData);

      // 🚀 Auto-log the login event
      logHqAction(userData.name, "Authentication", "User authenticated into HQ Portal");
      
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
    const authorizedTabs = ['admin', 'superadmin'].includes(safeRole) ? TABS : (perms[safeRole] || []);
    setActiveTab(authorizedTabs[0] || TABS[0]); 

    // 🚀 Auto-log brand switching
    logHqAction(user.name, "Navigation", `Switched active division to ${brand.name}`);
  };

  const handleLogout = () => {
    if (user) {
        logHqAction(user.name, "Authentication", "User logged out of HQ Portal");
    }
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
  const myTabs = ['admin', 'superadmin'].includes(safeUserRole) ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

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
              onClick={() => { window.location.href = '/'; }}
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
        {/* 'App Imp.' is force-included: feedback must be reachable by EVERY role, so it never
            depends on a permission-matrix row. */}
        {TABS.filter(t => (myTabs.includes(t) || t === 'App Imp.' || t === 'User Guide') && t !== 'ERP_WRITE_BACK').map((tab) => {
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
              {TAB_LABELS[tab] || tab}
              {tab === '10.7 OS Comms' && unreadMsgs.length > 0 && (
                <span title={`${unreadMsgs.length} unread message${unreadMsgs.length === 1 ? '' : 's'}`} style={{ color: '#d9534f', fontSize: '17px', fontWeight: 700, marginLeft: '5px', lineHeight: 0, verticalAlign: 'super' }}>*</span>
              )}
              {tab === '1. Inception & Validation' && unseenPins && (
                <span title="New pin on the Inception board" style={{ color: '#d9534f', fontSize: '17px', fontWeight: 700, marginLeft: '5px', lineHeight: 0, verticalAlign: 'super' }}>*</span>
              )}
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
            {activeTab === '1. Inception & Validation' && <InceptionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '1.5 Node Grouping' && <NodeClusterTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '1.6 Assembly Builder' && <AssemblyBuilderTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '2. Visual Assembly' && <VisualAssemblyTab currentUser={user.name} activeBrand={activeBrand.id} onProceed={() => setActiveTab('3. BOM Engine')} />}
            {activeTab === '3. BOM Engine' && <BOMTab currentUser={user.name} activeBrand={activeBrand.id} />}
            
            {/* 🚀 Wired up focusItemId for auto-opening parts from other tabs */}
            {activeTab === '4. Master Library' && (
                <LibraryTab 
                    currentUser={user.name} 
                    activeBrand={activeBrand.id} 
                    focusItemId={libraryFocusItemId}
                    clearFocus={() => setLibraryFocusItemId(null)}
                />
            )}
            
            {activeTab === '4.5 Mass Update' && <LibraryMassUpdateTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '4.6 Customer Collections' && <CustomerCollectionsTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '6. Instructions' && <InstructionsTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '6.5 Tools, Specs & FAQs' && <ToolsSpecsTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '7. Quick Ship' && <QuickShipTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '15. Packaging' && <PackagingTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '8. CPQ Configurator' && <CPQTab currentUser={user.name} activeBrand={activeBrand.id} cart={globalCart} setCart={setGlobalCart} isSuperAdmin={user?.superAdmin === true || safeUserRole === 'superadmin'} />}
            {activeTab === '9. Client Vision' && <ClientVisionTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '9.5 UPS Shipping' && <UPSShippingCalculator currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '10. External Co-Op' && <ExternalCoopTab currentUser={user.name} activeBrand={activeBrand.id} userRole={safeUserRole} />}
            {activeTab === '10.5 Project Mgmt' && <ProjectManagementTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '10.7 OS Comms' && <SharedMessaging currentUser={user.name} currentApp="HQ" writeLog={logHqAction} />}
            {activeTab === '11. System Admin' && <AdminTab currentUser={user.name} activeBrand={activeBrand.id} perms={perms} setPerms={setPerms} TABS={TABS} writeLog={logHqAction} />}
            {activeTab === '11.1 NetSuite Sync' && <NetSuiteSyncTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '11.2 ERP Mapping Audit' && <ErpMappingAudit currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '12. ERP Push / Pull' && <ERPPushPullTab currentUser={user.name} activeBrand={activeBrand.id} />}
            
            {/* 🚀 Wired up onNavigateToLibrary to set the focus ID and switch tabs */}
            {activeTab === '12.5 Stock View' && (
                <StockViewTab 
                    currentUser={user.name} 
                    activeBrand={activeBrand.id} 
                    onNavigateToLibrary={(itemId) => {
                        setLibraryFocusItemId(itemId);
                        setActiveTab('4. Master Library');
                    }}
                />
            )}
            
            {activeTab === '13. RTG Dispatch' && <RTGDispatchTab currentUser={user.name} activeBrand={activeBrand.id} userRole={safeUserRole} />}
            {activeTab === '14. Asset Gallery' && <AssetGalleryTab currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '14.5 Batch Processor' && <BatchImageProcessor currentUser={user.name} activeBrand={activeBrand.id} />}
            {activeTab === '14.6 Texture Processor' && <BatchTextureProcessor currentUser={user.name} />}
            {activeTab === 'App Imp.' && <AppImprovementTab currentUser={user.name} currentApp="HQ" canManage={['admin', 'superadmin'].includes(safeUserRole)} />}
            {activeTab === 'User Guide' && <UserGuideTab />}
          </Suspense>

        </div>
      </main>
    </div>
  );
}

export default HQ;