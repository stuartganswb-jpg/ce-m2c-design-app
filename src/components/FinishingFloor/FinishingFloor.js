import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { finishingDb as db } from '../../firebase'; 
import { collection, onSnapshot, query, doc, getDoc, addDoc, serverTimestamp, getDocs, where, orderBy, limit } from "firebase/firestore";
import SetupQueue from './SetupQueue';
import ActiveFloor from './ActiveFloor';
import Recipes from './Recipes';
import Supplies from './Supplies';
import Management from './Management';
import Summary from './Summary';
import { MixModal, QcModal } from './Modals';

// 🚀 SHARED APPS
import FloorAssetViewer from './FloorAssetViewer';
import SharedMessaging from '../Shared/SharedMessaging';

const TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'OS COMMS', 'ASSET GALLERY', 'MANAGEMENT', 'DAILY SUMMARY'];

const FinishingFloor = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [activeTab, setActiveTab] = useState('ACTIVE FLOOR');
  const [perms, setPerms] = useState({});
  
  const [workOrders, setWorkOrders] = useState([]);
  const [recipes, setRecipes] = useState({});
  const [paintProfiles, setPaintProfiles] = useState({});
  const [activePots, setActivePots] = useState({});
  const [supplies, setSupplies] = useState([]);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sysConfig, setSysConfig] = useState({ setupSecs: 30, smallPartsBatchSize: 70, smallPartsBatchMinutes: 6, poleMinutesPerPiece: 3, potLifeMins: 180, recoatWindowMins: 90 });
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
      onSnapshot(collection(db, "fin_users"), (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, "fin_logs"), orderBy("t", "desc"), limit(50)), (snap) => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(doc(db, "fin_config", "settings"), (docSnap) => { if (docSnap.exists()) setSysConfig(prev => ({ ...prev, ...docSnap.data() })); })
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [user]);

  const writeLog = (msg, cat) => addDoc(collection(db, "fin_logs"), { u: user.name, msg, cat, t: serverTimestamp() });

  const attemptLogin = async (e) => {
    e.preventDefault();
    if (!pinInput) return;
    try {
      if (pinInput === "1032") {
        setUser({ name: "Master Admin", role: "admin" });
        setPerms({ admin: TABS });
        return;
      }
      
      const uSnap = await getDocs(query(collection(db, "fin_users"), where("pin", "==", pinInput)));
      if (!uSnap.empty) {
        const uData = uSnap.docs[0].data();
        const pSnap = await getDoc(doc(db, "fin_config", "permissions"));
        let pData = pSnap.exists() ? pSnap.data() : {};
        
        setPerms(pData);
        setUser(uData);

        const r = uData.role ? uData.role.toLowerCase() : 'operator';
        setActiveTab(pData[r]?.includes('ACTIVE FLOOR') ? 'ACTIVE FLOOR' : (pData[r]?.[0] || 'ACTIVE FLOOR'));
      } else {
        alert("Invalid PIN.");
      }
    } catch (err) { console.error(err); alert("Authentication failed."); }
  };

  const safeUserRole = user?.role ? user.role.toLowerCase() : 'operator';
  const myTabs = user?.role === 'admin' ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

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
          <button onClick={() => navigate('/')} style={{ marginTop: '30px', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid var(--brass)', paddingBottom: '2px' }}>Return to Hub</button>
        </div>
      </div>
    );
  }

return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--paper)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--sans)' }}>
      <header style={{ backgroundColor: '#fff', color: 'var(--ink)', padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '4px solid var(--brass)', borderBottom: '1px solid var(--line)' }}>
        <div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontFamily: 'var(--serif)', fontWeight: 500, letterSpacing: '0.05em' }}>Finishing O.S.</h1>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', letterSpacing: '.18em', textTransform: 'uppercase' }}>Shop Floor Execution</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <span style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Operator: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{user.name}</strong></span>
          <button onClick={() => navigate('/')} style={{ padding: '8px 16px', cursor: 'pointer', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Return to Hub</button>
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
          {activeTab === 'SETUP QUEUE' && <SetupQueue workOrders={workOrders} recipes={recipes} writeLog={writeLog} />}
          {activeTab === 'ACTIVE FLOOR' && <ActiveFloor workOrders={workOrders} recipes={recipes} activePots={activePots} sysConfig={sysConfig} setMixModal={setMixModal} now={now} user={user} setQcModal={setQcModal} users={users} />}
          {activeTab === 'FINISH RECIPES' && <Recipes recipes={recipes} paintProfiles={paintProfiles} supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'SUPPLIES' && <Supplies supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'MANAGEMENT' && <Management sysConfig={sysConfig} users={users} logs={logs} writeLog={writeLog} user={user} perms={perms} setPerms={setPerms} db={db} TABS={TABS} />}
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