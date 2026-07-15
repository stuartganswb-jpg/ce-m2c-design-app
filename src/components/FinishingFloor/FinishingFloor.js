import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { finishingDb as db, auth, functions } from '../../firebase';
import { collection, onSnapshot, query, doc, getDoc, addDoc, serverTimestamp, orderBy, limit } from "firebase/firestore";
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import SetupQueue from './SetupQueue';
import SchedulePlanner from './SchedulePlanner';
import ActiveFloor from './ActiveFloor';
import ProductionTimes from './ProductionTimes';
import Recipes from './Recipes';
import Supplies from './Supplies';
import Summary from './Summary';
import { MixModal, QcModal } from './Modals';

// 🚀 SHARED APPS
import FloorAssetViewer from './FloorAssetViewer';
import SharedMessaging from '../Shared/SharedMessaging';

// REMOVED 'MANAGEMENT' FROM THIS ARRAY (user/permission admin now lives in the HQ Admin tab).
// PRODUCTION TIMES is the focused finishing-config tab: production timers + the time matrix.
const TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'PRODUCTION TIMES', 'OS COMMS', 'ASSET GALLERY', 'DAILY SUMMARY'];

const FinishingFloor = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [activeTab, setActiveTab] = useState('ACTIVE FLOOR');
  const [perms, setPerms] = useState({});
  
  const [workOrdersRaw, setWorkOrders] = useState([]);
  // DIVISION SWITCHER (Stuart 2026-07-14, matches the WMS header pattern): filter the finishing
  // queues in place instead of bouncing back to the landing screen. 'all' = every division; work
  // orders WITHOUT a brand stamp (legacy) stay visible under every division — never hide work.
  const [floorBrand, setFloorBrand] = useState(() => { try { return localStorage.getItem('ff_brand') || 'all'; } catch (e) { return 'all'; } });
  const pickFloorBrand = (b) => { setFloorBrand(b); try { localStorage.setItem('ff_brand', b); } catch (e) { /* storage unavailable */ } };
  const workOrders = floorBrand === 'all'
    ? workOrdersRaw
    : workOrdersRaw.filter(w => { const b = String(w?.brand || w?.brandId || '').toLowerCase(); return !b || b === floorBrand; });
  const [recipes, setRecipes] = useState({});
  const [paintProfiles, setPaintProfiles] = useState({});
  const [activePots, setActivePots] = useState({});
  const [supplies, setSupplies] = useState([]);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sysConfig, setSysConfig] = useState({ setupSecs: 30, smallPartsBatchSize: 70, smallPartsBatchMinutes: 6, poleMinutesPerPiece: 3, potLifeMins: 180, recoatWindowMins: 90, activeFloorDailyCapacity: 200 });
  const [capacityMatrix, setCapacityMatrix] = useState({});
  const [prodTypes, setProdTypes] = useState([]); // HQ master dictionary (system/master_lists.prodTypes)
  const [now, setNow] = useState(Date.now());
  const [mixModal, setMixModal] = useState(null); 
  const [qcModal, setQcModal] = useState(null); 

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer); 
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      onSnapshot(collection(db, "fin_workorders"), (snap) => setWorkOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "fin_recipes"), (snap) => { let r = {}; snap.docs.forEach(d => r[d.id] = d.data()); setRecipes(r); }),
      onSnapshot(collection(db, "fin_paint_profiles"), (snap) => { let p = {}; snap.docs.forEach(d => p[d.id] = d.data()); setPaintProfiles(p); }),
      onSnapshot(collection(db, "fin_pots"), (snap) => { let pts = {}; snap.docs.forEach(d => pts[d.id] = d.data().mixedAt); setActivePots(pts); }),
      onSnapshot(collection(db, "fin_supplies"), (snap) => setSupplies(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "hq_users"), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, "hq_logs"), orderBy("t", "desc"), limit(50)), (snap) => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(doc(db, "fin_config", "settings"), (docSnap) => { if (docSnap.exists()) setSysConfig(prev => ({ ...prev, ...docSnap.data() })); }),
      onSnapshot(doc(db, "fin_config", "capacityMatrix"), (docSnap) => setCapacityMatrix(docSnap.exists() ? docSnap.data() : {})),
      onSnapshot(doc(db, "system", "master_lists"), (docSnap) => setProdTypes(docSnap.exists() ? (docSnap.data().prodTypes || []) : []))
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [user]);

  const writeLog = async (msg, cat) => {
    try { await addDoc(collection(db, "hq_logs"), { u: user?.name || 'Unknown', msg, cat, t: serverTimestamp() }); } 
    catch (error) { console.error("Failed to write log:", error); }
  };

  const attemptLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;
    try {
      // 🔐 Same secure flow as HQ: mint a custom token server-side, then sign in.
      const authenticatePin = httpsCallable(functions, 'authenticatePin');
      const result = await authenticatePin({ pin: pinInput });
      const { token, user: userData } = result.data;

      await signInWithCustomToken(auth, token);

      // All-tabs access is granted at render time to the admin/superadmin role claim (see myTabs);
      // there is no client-side master PIN. Everyone loads their configured permissions here.
      const pSnap = await getDoc(doc(db, "fin_config", "permissions"));
      const pData = pSnap.exists() ? pSnap.data() : {};
      setPerms(pData);
      setUser(userData);

      const r = userData.role ? userData.role.toLowerCase() : 'operator';
      // Return the operator to the screen they were on — it survives the per-transaction logout
      // (component stays mounted). Only default if their current tab isn't permitted.
      const allowed = pData[r];
      setActiveTab(prev => (!allowed || allowed.includes(prev)) ? prev : (allowed.includes('ACTIVE FLOOR') ? 'ACTIVE FLOOR' : (allowed[0] || 'ACTIVE FLOOR')));
    } catch (err) {
      console.error(err);
      alert("Authentication failed: " + (err.message || "Invalid PIN"));
      setPinInput("");
    }
  };

  // Tab gating. Super admin = a flag on the hq_users record (not a matrix role), so the login token
  // alone can't always identify it. Resolve the authoritative directory record we already subscribe
  // to and treat the check as ADDITIVE — it can only grant more access, never downgrade what the
  // token role already allows. Other roles stay gated by fin_config/permissions.
  // Normalize role strings to alpha-only lowercase so 'SUPERADMIN', 'super admin', 'super_admin'
  // all collapse to 'superadmin' (and 'Admin' -> 'admin'). Match the directory record case-
  // insensitively by pin/id/name. The check is additive: it only ever grants more access.
  const normRole = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const tokenRole = (user?.role || 'operator').toLowerCase();
  const uname = (user?.name || '').toLowerCase();
  const meRecord = users.find(u =>
    (user?.pin && String(u.pin) === String(user.pin)) ||
    (user?.id && String(u.id) === String(user.id)) ||
    (uname && String(u.name || '').toLowerCase() === uname)
  ) || {};
  const dirRole = (meRecord.role || '').toLowerCase();
  const isSuperAdmin = user?.superAdmin === true || meRecord.superAdmin === true ||
    ['admin', 'superadmin'].includes(normRole(tokenRole)) || ['admin', 'superadmin'].includes(normRole(dirRole));
  const safeUserRole = tokenRole;
  const myTabs = isSuperAdmin ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

  const handleLogout = () => {
    localStorage.removeItem('hq_session');
    navigate('/');
  };

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--paper)', fontFamily: 'var(--sans)' }}>
        <div style={{ background: '#fff', padding: '50px 40px', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '400px', textAlign: 'center', borderRadius: '2px' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: 'var(--brass)', display: 'block', marginBottom: '1rem' }}>
            Authorization Required
          </span>
          <h1 style={{ margin: '0 0 30px 0', color: 'var(--ink)', fontSize: '2.2rem', fontFamily: 'var(--serif)', fontWeight: 500 }}>Finishing O.S.</h1>
          <form onSubmit={attemptLogin}>
            <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{width: '100%', padding: '15px', textAlign: 'center', fontSize: '1.5rem', marginBottom: '20px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--mono)', letterSpacing: '10px', outline: 'none'}} />
            <button type="submit" style={{ width: '100%', padding: '15px', background: 'var(--ink)', color: '#fff', fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}>Authenticate</button>
          </form>
          <button onClick={handleLogout} style={{ marginTop: '30px', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid var(--brass)', paddingBottom: '2px' }}>Return to Hub</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--paper)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--sans)' }}>
      <header style={{ backgroundColor: '#fff', color: 'var(--ink)', padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '4px solid var(--brass)', borderBottom: '1px solid var(--line)' }}>
        <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontFamily: 'var(--serif)', fontWeight: 500, letterSpacing: '0.05em' }}>Finishing O.S.</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', letterSpacing: '.18em', textTransform: 'uppercase' }}>Shop Floor Execution</span>
                <select value={floorBrand} onChange={e => pickFloorBrand(e.target.value)} title="Division filter — work orders without a division stamp always show" style={{ padding: '2px 5px', fontSize: '10px', fontFamily: 'var(--mono)', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', outline: 'none', textTransform: 'uppercase', cursor: 'pointer' }}>
                    <option value="all">All Divisions</option>
                    <option value="ce">Classical Elements</option>
                    <option value="m2c">M2C Studio</option>
                    <option value="uniquity">Uniquity</option>
                    <option value="leyla">Leyla Gans LLC</option>
                </select>
            </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <span style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Operator: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{user.name}</strong></span>
          <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Return to Hub</button>
        </div>
      </header>
      <nav style={{ display: 'flex', backgroundColor: 'var(--paper)', borderBottom: '1px solid var(--line)', overflowX: 'auto', padding: '0 20px' }}>
        {TABS.filter(t => myTabs.includes(t)).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ whiteSpace: 'nowrap', padding: '16px 20px', cursor: 'pointer', border: 'none', borderBottom: activeTab === tab ? `2px solid var(--brass)` : '2px solid transparent', background: 'transparent', color: activeTab === tab ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: 400, fontFamily: 'var(--mono)', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '.1em', transition: 'all 0.2s', opacity: activeTab === tab ? 1 : 0.7 }}>
            {tab}
          </button>
        ))}
      </nav>
      <main style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ backgroundColor: '#fff', border: '1px solid var(--line)', flex: 1, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto', borderRadius: '2px' }}>
          {activeTab === 'SETUP QUEUE' && <SetupQueue workOrders={workOrders} recipes={recipes} writeLog={writeLog} sysConfig={sysConfig} />}
          {activeTab === 'SETUP QUEUE' && <div style={{ padding: '0 30px 30px' }}><SchedulePlanner workOrders={workOrders} recipes={recipes} capacityMatrix={capacityMatrix} sysConfig={sysConfig} /></div>}
          {activeTab === 'ACTIVE FLOOR' && <ActiveFloor workOrders={workOrders} recipes={recipes} activePots={activePots} sysConfig={sysConfig} setMixModal={setMixModal} now={now} user={user} setQcModal={setQcModal} users={users} />}
          {activeTab === 'FINISH RECIPES' && <Recipes recipes={recipes} paintProfiles={paintProfiles} supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'PRODUCTION TIMES' && <ProductionTimes sysConfig={sysConfig} capacityMatrix={capacityMatrix} recipes={recipes} workOrders={workOrders} prodTypes={prodTypes} writeLog={writeLog} user={user} />}
          {activeTab === 'SUPPLIES' && <Supplies supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'DAILY SUMMARY' && <Summary workOrders={workOrders} />}
          
          {/* 🚀 SHARED APPS */}
          {activeTab === 'ASSET GALLERY' && <FloorAssetViewer activeBrand={null} />}
          {activeTab === 'OS COMMS' && <SharedMessaging currentUser={user.name} currentApp="FINISHING" writeLog={writeLog} />}
        </div>
      </main>
      
      {mixModal && <MixModal color={mixModal} paintProfiles={paintProfiles} setMixModal={setMixModal} writeLog={writeLog} user={user} />}
      {qcModal && <QcModal qcModal={qcModal} setQcModal={setQcModal} writeLog={writeLog} user={user} setUser={setUser} workOrders={workOrders} />}
    </div>
  );
};

export default FinishingFloor;