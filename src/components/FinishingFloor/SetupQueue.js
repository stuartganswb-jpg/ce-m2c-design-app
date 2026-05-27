import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc, setDoc, deleteDoc, serverTimestamp, collection, query, where, onSnapshot } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle } from './finishingStyles';

const cardStyle = { background: '#fff', padding: '15px', border: '1px solid #ccc', boxShadow: '4px 4px 0 rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' };

const SetupQueue = ({ workOrders = [], recipes = {}, writeLog }) => {
  const getThreeWeeksOut = () => {
      const d = new Date();
      d.setDate(d.getDate() + 21);
      return d.toISOString().split('T')[0];
  };

  const [orderType, setOrderType] = useState('sales'); 
  const [woId, setWoId] = useState("");
  const [soId, setSoId] = useState("");
  const [customer, setCustomer] = useState("");
  const [recipe, setRecipe] = useState("");
  
  const [qty, setQty] = useState(""); 
  const [poles, setPoles] = useState("");
  const [finials, setFinials] = useState("");
  const [rings, setRings] = useState("");
  const [brackets, setBrackets] = useState("");
  
  const [reqDate, setReqDate] = useState(getThreeWeeksOut());
  const [aiOptimized, setAiOptimized] = useState(false);

  // NEW: State for Cross-App Alerts from Shop Floor
  const [alerts, setAlerts] = useState([]);
  
  // 🚀 NEW: State for Golden Payload Modal
  const [activeSpecs, setActiveSpecs] = useState(null);

  useEffect(() => { setReqDate(getThreeWeeksOut()); }, [orderType]);

  // NEW: Listener for Shop Floor Completion Alerts
  useEffect(() => {
      const q = query(collection(db, "shop_finishing_alerts"), where("read", "==", false));
      const unsub = onSnapshot(q, snap => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
      return () => unsub();
  }, []);

  const handleCreateOrder = async () => {
      if(!woId || !recipe) return alert("Work Order # and Recipe are strictly required.");
      if(orderType === 'sales' && !soId) return alert("Sales Orders require an SO #.");
      
      let totalPartsCalc = 0;
      let extraData = {};

      if (orderType === 'sales') {
          const p = parseInt(poles) || 0;
          const f = parseInt(finials) || 0;
          const r = parseInt(rings) || 0;
          const b = parseInt(brackets) || 0;
          totalPartsCalc = p + f + r + b;
          
          if (totalPartsCalc === 0) return alert("Please enter part quantities.");
          
          extraData = { poles: { qty: p }, smallParts: { fin: f, rng: r, brk: b } };
      } else {
          totalPartsCalc = parseInt(qty) || 0;
          if (totalPartsCalc === 0) return alert("Please enter total parts for stock order.");
          extraData = { stock: { qty: totalPartsCalc } };
      }
      
      const newWO = {
          id: woId, 
          displayId: woId,
          type: orderType,
          soId: orderType === 'sales' ? soId : 'N/A',
          customer: orderType === 'sales' ? customer : 'Internal Stock',
          reqDate: reqDate || getThreeWeeksOut(),
          recipe: recipe,
          totalParts: totalPartsCalc,
          currentPhase: 'Setup',
          stepStatus: 'Pending',
          createdAt: serverTimestamp(),
          ...extraData
      };
      
      try {
          await setDoc(doc(db, "fin_workorders", woId), newWO);
          if (writeLog) writeLog(`Created new ${orderType} WO: ${woId}`, 'setup');
          
          setWoId(""); setSoId(""); setCustomer(""); setRecipe(""); 
          setQty(""); setPoles(""); setFinials(""); setRings(""); setBrackets("");
          setReqDate(getThreeWeeksOut());
      } catch (err) {
          console.error("Firebase Write Error:", err);
          alert(`Creation Failed! Error: ${err.message}`);
      }
  };

  const handleClearAlert = async (alertId) => {
      await updateDoc(doc(db, "shop_finishing_alerts", alertId), { read: true });
      if (writeLog) writeLog(`Acknowledged Shop Floor transfer alert ${alertId}`, 'setup');
  };

  let pendingOrders = workOrders.filter(w => w.currentPhase === "Setup" || w.currentPhase === "setup");
  pendingOrders.sort((a, b) => new Date(a.reqDate) - new Date(b.reqDate));

  if (aiOptimized) {
      pendingOrders = pendingOrders.sort((a, b) => {
          const dateA = new Date(a.reqDate);
          const dateB = new Date(b.reqDate);
          const diffDays = (dateA - dateB) / (1000 * 60 * 60 * 24);
          if (Math.abs(diffDays) <= 7) {
              if (a.recipe < b.recipe) return -1;
              if (a.recipe > b.recipe) return 1;
          }
          return dateA - dateB;
      });
  }

  // --- DIAGNOSTIC ERROR CATCHERS ---
  const startSetup = async (wo) => {
    try {
        await updateDoc(doc(db, "fin_workorders", wo.id), { stepStatus: "Running" });
        if (writeLog) writeLog(`Started Setup for ${wo.displayId || wo.id}`, 'production');
    } catch (err) {
        console.error("Start Setup Error:", err);
        alert(`FIREBASE BLOCKED UPDATE for ID [${wo.id}]. Reason: ${err.message}`);
    }
  };

  const stageToFloor = async (wo) => {
    try {
        await updateDoc(doc(db, "fin_workorders", wo.id), { stepStatus: "Staged", currentPhase: "Painting", currentStepIndex: 0 });
        if (writeLog) writeLog(`Staged ${wo.displayId || wo.id} to Floor`, 'production');
    } catch (err) {
        console.error("Stage to Floor Error:", err);
        alert(`FIREBASE BLOCKED STAGE for ID [${wo.id}]. Reason: ${err.message}`);
    }
  };

  // --- THE NUKE BUTTON FUNCTION ---
  const nukeQueue = async () => {
      const confirm = window.confirm("☢️ WARNING: This will permanently delete ALL jobs currently visible in this queue from the database. Proceed?");
      if (confirm) {
          for (let wo of pendingOrders) {
              try { await deleteDoc(doc(db, "fin_workorders", wo.id)); } 
              catch(e) { console.error("Could not delete", wo.id, e); }
          }
          alert("Queue Nuked. You have a clean slate.");
      }
  };

  return (
    <div style={{ padding: '30px' }}>
      
      {/* CROSS-APP ALERTS BANNER */}
      {alerts.length > 0 && (
          <div style={{ background: '#fff3cd', border: '2px solid #ffecb5', padding: '15px', marginBottom: '20px', borderRadius: '6px', boxShadow: '4px 4px 0 rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#856404', display: 'flex', alignItems: 'center', gap: '10px' }}>🚨 INCOMING PARTS FROM SHOP FLOOR</h3>
              {alerts.map(a => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '10px', marginBottom: '5px', borderRadius: '4px', border: '1px solid #ffeeba' }}>
                      <span style={{ fontWeight: 'bold', color: '#856404' }}>{a.msg}</span>
                      <button onClick={() => handleClearAlert(a.id)} style={{ background: '#28a745', color: '#fff', border: 'none', padding: '6px 12px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>ACKNOWLEDGE & CLEAR</button>
                  </div>
              ))}
          </div>
      )}

      <div style={{ background: '#fff', border: '2px solid #333', padding: '20px', marginBottom: '30px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>DIRECT ORDER INTAKE</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOrderType('sales')} style={{ ...btnStyle, background: orderType === 'sales' ? '#333' : '#f4f4f4', color: orderType === 'sales' ? '#fff' : '#333' }}>SALES ORDER</button>
                  <button onClick={() => setOrderType('stock')} style={{ ...btnStyle, background: orderType === 'stock' ? '#333' : '#f4f4f4', color: orderType === 'stock' ? '#fff' : '#333' }}>STOCK ORDER</button>
              </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', alignItems: 'end' }}>
              <div><label style={labelStyle}>WORK ORDER #</label><input value={woId} onChange={e=>setWoId(e.target.value)} style={inputStyle} /></div>
              
              {orderType === 'sales' && (
                  <>
                      <div><label style={labelStyle}>SALES ORDER #</label><input value={soId} onChange={e=>setSoId(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>CUSTOMER</label><input value={customer} onChange={e=>setCustomer(e.target.value)} style={inputStyle} /></div>
                  </>
              )}
              
              <div>
                  <label style={labelStyle}>FINISH RECIPE</label>
                  <select value={recipe} onChange={e=>setRecipe(e.target.value)} style={inputStyle}>
                      <option value="">Select Finish...</option>
                      {recipes && Object.keys(recipes).map(rCode => (
                          <option key={rCode} value={rCode}>{rCode}</option>
                      ))}
                  </select>
              </div>

              {orderType === 'stock' ? (
                  <div><label style={labelStyle}>TOTAL PARTS</label><input type="number" value={qty} onChange={e=>setQty(e.target.value)} style={inputStyle} /></div>
              ) : (
                  <>
                      <div><label style={labelStyle}>POLES</label><input type="number" value={poles} onChange={e=>setPoles(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>FINIALS</label><input type="number" value={finials} onChange={e=>setFinials(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>RINGS</label><input type="number" value={rings} onChange={e=>setRings(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>BRACKETS</label><input type="number" value={brackets} onChange={e=>setBrackets(e.target.value)} style={inputStyle} /></div>
                  </>
              )}

              <div><label style={labelStyle}>REQUIRED DATE</label><input type="date" value={reqDate} onChange={e=>setReqDate(e.target.value)} style={inputStyle} /></div>
          </div>
          <button onClick={handleCreateOrder} style={{ ...btnStyle, marginTop: '20px', width: '100%', background: '#007bff', color: '#fff' }}>+ INGEST TO QUEUE</button>
      </div>

      <div style={{ background: '#e9ecef', padding: '15px', border: '2px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#333' }}>WORK ORDER QUEUE</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={nukeQueue} style={{ padding: '12px 24px', background: '#dc3545', color: '#fff', border: '2px solid #333', cursor: 'pointer', fontWeight: 'bold' }}>☢️ NUKE QUEUE</button>
            <button onClick={() => setAiOptimized(!aiOptimized)} style={{ padding: '12px 24px', background: aiOptimized ? '#6f42c1' : '#fff', color: aiOptimized ? '#fff' : '#333', border: '2px solid #333', cursor: 'pointer', fontWeight: 'bold', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)', transition: 'all 0.2s' }}>
                {aiOptimized ? '✨ AI BATCHING: ACTIVE' : '🤖 ACTIVATE AI BATCHING'}
            </button>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '15px' }}>
        {pendingOrders.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#999', fontStyle: 'italic', gridColumn: '1/-1' }}>Queue is empty.</div>
        ) : (
          pendingOrders.map(wo => (
            <div key={wo.id} style={{...cardStyle, borderLeft: aiOptimized ? '5px solid #6f42c1' : '5px solid #333'}}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #eee', paddingBottom: '5px', marginBottom: '10px' }}>
                    <strong style={{ fontSize: '1.2rem', color: '#007bff' }}>
                        WO: {wo.woNum || wo.displayId || wo.id}
                        {(wo.type === 'sales' || wo.soNum) && <span style={{color:'#333', fontSize:'0.9rem'}}> (SO: {wo.soId || wo.soNum})</span>}
                    </strong>
                    <span style={{ background: '#f4f4f4', padding: '2px 8px', fontSize: '0.9rem', fontWeight: 'bold', border: '1px solid #ccc' }}>{wo.recipe || wo.color}</span>
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: '10px' }}><b>Customer:</b> {wo.customer || wo.clientName || 'N/A'}</div>
                <div style={{ fontSize: '0.85rem', marginBottom: '10px' }}><b>Req Date:</b> <span style={{ color: '#d9534f', fontWeight: 'bold' }}>{wo.reqDate || 'ASAP'}</span></div>
                
                <div style={{ fontSize: '0.85rem', lineHeight: '1.4' }}>
                    <b>Type:</b> {(wo.type || wo.itemName || 'Custom').toUpperCase()} | <b>Total Parts:</b> {wo.totalParts || wo.qty || 1} <br/>
                    {wo.type === 'sales' && (
                        <span style={{color: '#666'}}>
                            (Poles: {wo.poles?.qty || 0}, Fin: {wo.smallParts?.fin || 0}, Rng: {wo.smallParts?.rng || 0}, Brk: {wo.smallParts?.brk || 0})
                        </span>
                    )}
                    {wo.dimensions && (
                        <div style={{ color: '#CC6600', fontWeight: 'bold', marginTop: '5px', fontSize: '0.85rem' }}>
                            📐 Item Dimensions: {wo.dimensions.length}L x {wo.dimensions.width}W x {wo.dimensions.height}H
                        </div>
                    )}
                </div>
                
                {/* 🚀 UPGRADED BUTTON LAYOUT WITH GOLDEN PAYLOAD TRIGGER */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                    <button onClick={() => setActiveSpecs(wo)} style={{ ...btnStyle, flex: 1, background: '#17a2b8', color: '#fff', padding: '10px', fontSize: '0.8rem' }}>🖼️ SPECS</button>
                    {wo.stepStatus === "Pending" ? (
                        <button onClick={() => startSetup(wo)} style={{ ...btnStyle, flex: 2, background: '#e9ecef', padding: '10px', fontSize: '0.8rem' }}>START SETUP</button>
                    ) : (
                        <button onClick={() => stageToFloor(wo)} style={{ ...btnStyle, flex: 2, background: '#28a745', color: '#fff', padding: '10px', fontSize: '0.8rem' }}>STAGE TO FLOOR</button>
                    )}
                </div>
            </div>
          ))
        )}
      </div>

      {/* 🚀 BRAND NEW: THE GOLDEN PAYLOAD MODAL */}
      {activeSpecs && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#fff', padding: '30px', borderRadius: '12px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '4px solid #333', boxShadow: '10px 10px 0 #CC6600' }}>
                  <h2 style={{ color: '#CC6600', marginTop: 0, borderBottom: '2px solid #ccc', paddingBottom: '10px' }}>JOB SPECIFICATIONS: {activeSpecs.woNum || activeSpecs.displayId || activeSpecs.id}</h2>
                  
                  <div style={{ display: 'flex', gap: '20px' }}>
                      {activeSpecs.imageUrl && (
                          <div style={{ flex: 1 }}>
                              <img src={activeSpecs.imageUrl} alt="Part" style={{ width: '100%', border: '2px solid #ccc', borderRadius: '8px' }}/>
                          </div>
                      )}
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '2px solid #ccc' }}>
                              <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>CLIENT</div>
                              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#000' }}>{activeSpecs.clientName || activeSpecs.customer || 'N/A'}</div>
                          </div>
                          
                          {activeSpecs.note && (
                              <div style={{ background: '#fffdf5', padding: '15px', borderRadius: '8px', border: '2px solid #f39c12' }}>
                                  <div style={{ fontSize: '12px', color: '#f39c12', fontWeight: 'bold' }}>CLIENT / RFI NOTES</div>
                                  <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{activeSpecs.note}</div>
                              </div>
                          )}
                          
                          {activeSpecs.cpqSpecs && Object.keys(activeSpecs.cpqSpecs).length > 0 && (
                              <div style={{ background: '#eef5ff', padding: '15px', borderRadius: '8px', border: '2px solid #0056b3' }}>
                                  <div style={{ fontSize: '12px', color: '#0056b3', fontWeight: 'bold', marginBottom: '5px' }}>CPQ BUILD SPECS</div>
                                  {Object.entries(activeSpecs.cpqSpecs).map(([k, v]) => (
                                      <div key={k} style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #cce0ff', padding: '6px 0' }}>
                                          <span style={{ color: '#555' }}>{k}:</span><span style={{ fontWeight: 'bold' }}>{v}</span>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {/* Fallback if no specs or notes exist but they opened the modal */}
                          {!activeSpecs.imageUrl && !activeSpecs.note && (!activeSpecs.cpqSpecs || Object.keys(activeSpecs.cpqSpecs).length === 0) && (
                              <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontStyle: 'italic', border: '1px dashed #ccc', borderRadius: '8px' }}>
                                  No extended specifications or client notes attached to this Work Order.
                              </div>
                          )}
                      </div>
                  </div>
                  
                  <button onClick={() => setActiveSpecs(null)} style={{ width: '100%', background: '#333', border: 'none', padding: '15px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px', borderRadius: '6px' }}>CLOSE VIEW</button>
              </div>
          </div>
      )}
    </div>
  );
};

export default SetupQueue;