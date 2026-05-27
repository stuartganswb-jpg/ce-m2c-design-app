import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { finishingDb as db } from '../../firebase'; 
import { collection, onSnapshot, query, doc, getDoc, addDoc, serverTimestamp, getDocs, where, orderBy, limit } from "firebase/firestore";
import SetupQueue from './SetupQueue';
import ActiveFloor from './ActiveFloor';
import Recipes from './Recipes';
import Supplies from './Supplies';
import Messaging from './Messaging';
import Management from './Management';
import Summary from './Summary';
import { MixModal, QcModal } from './Modals';

// 🚀 NEW: FLOOR-OPTIMIZED VISUAL DICTIONARY (Replaces HQ AssetGalleryTab)
import FloorAssetViewer from './FloorAssetViewer';

const TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'MESSAGING', 'ASSET GALLERY', 'MANAGEMENT', 'DAILY SUMMARY'];

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
  const [messages, setMessages] = useState([]);
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
      onSnapshot(query(collection(db, "fin_messaging"), orderBy("t", "desc")), (snap) => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
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
  // 🚀 PERMISSIONS BYPASS: Admins ALWAYS see all tabs
  const myTabs = user?.role === 'admin' ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', fontFamily: 'monospace' }}>
        <div style={{ background: '#fff', padding: '40px', border: '4px solid #333', boxShadow: '10px 10px 0 #CC6600', width: '350px', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 20px 0', color: '#CC6600', fontSize: '1.8rem' }}>FINISHING O.S.</h1>
          <form onSubmit={attemptLogin}>
            <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{width: '100%', padding: '10px', textAlign: 'center', fontSize: '1.5rem', marginBottom: '20px', border: '2px solid #ccc', boxSizing: 'border-box'}} />
            <button type="submit" style={{ width: '100%', padding: '15px', background: '#333', color: '#fff', fontSize: '1.2rem', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>LOGIN</button>
          </form>
          <button onClick={() => navigate('/')} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontWeight: 'bold' }}>← BACK TO HUB</button>
        </div>
      </div>
    );
  }

return (
    <div style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', display: 'flex', flexDirection: 'column', fontFamily: 'monospace' }}>
      <header style={{ backgroundColor: '#333', color: '#fff', padding: '15px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1 style={{ margin: 0, fontSize: '1.4rem' }}>FINISHING O.S.</h1></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => navigate('/')} style={{ padding: '8px 15px', cursor: 'pointer', background: '#fff', color: '#333', border: '2px solid #333', fontWeight: 'bold' }}>🏠 HUB</button>
        </div>
      </header>
      <nav style={{ display: 'flex', backgroundColor: '#fff', borderBottom: '4px solid #333', overflowX: 'auto' }}>
        {TABS.filter(t => myTabs.includes(t)).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, minWidth: '120px', padding: '15px 10px', cursor: 'pointer', border: 'none', borderRight: '2px solid #333', borderBottom: activeTab === tab ? `6px solid #CC6600` : '6px solid transparent', background: activeTab === tab ? '#FFF0E6' : 'transparent', fontWeight: activeTab === tab ? 'bold' : 'normal', textTransform: 'uppercase', fontSize: '0.75rem', transition: 'all 0.2s' }}>
            {tab}
          </button>
        ))}
      </nav>
      <main style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ backgroundColor: '#fff', border: '4px solid #333', flex: 1, boxShadow: '10px 10px 0px rgba(0,0,0,0.1)', overflowY: 'auto' }}>
          {activeTab === 'SETUP QUEUE' && <SetupQueue workOrders={workOrders} recipes={recipes} writeLog={writeLog} />}
          {activeTab === 'ACTIVE FLOOR' && <ActiveFloor workOrders={workOrders} recipes={recipes} activePots={activePots} sysConfig={sysConfig} setMixModal={setMixModal} now={now} user={user} setQcModal={setQcModal} users={users} />}
          {activeTab === 'FINISH RECIPES' && <Recipes recipes={recipes} paintProfiles={paintProfiles} supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'SUPPLIES' && <Supplies supplies={supplies} writeLog={writeLog} user={user} />}
          {activeTab === 'MESSAGING' && <Messaging messages={messages} user={user} />}
          {activeTab === 'MANAGEMENT' && <Management sysConfig={sysConfig} users={users} logs={logs} writeLog={writeLog} user={user} perms={perms} setPerms={setPerms} db={db} TABS={TABS} />}
          {activeTab === 'DAILY SUMMARY' && <Summary workOrders={workOrders} />}
          
          {/* 🚀 NEW ASSET GALLERY ROUTE FOR THE FLOOR */}
          {activeTab === 'ASSET GALLERY' && <FloorAssetViewer activeBrand={null} />}
        </div>
      </main>
      
      {mixModal && <MixModal color={mixModal} paintProfiles={paintProfiles} setMixModal={setMixModal} writeLog={writeLog} user={user} />}
      {qcModal && <QcModal qcModal={qcModal} setQcModal={setQcModal} writeLog={writeLog} user={user} setUser={setUser} workOrders={workOrders} />}
    </div>
  );
};

export default FinishingFloor;