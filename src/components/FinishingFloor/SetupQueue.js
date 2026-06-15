import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, updateDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle, sectionHeaderStyle, cardStyle } from './finishingStyles';
import { makeFullTasks } from '../Shared/workOrderContract';
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';

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

  const [activeSpecs, setActiveSpecs] = useState(null);
  const [cfgQuote, setCfgQuote] = useState(null); // "view configured item" read-only 3D modal

  useEffect(() => { setReqDate(getThreeWeeksOut()); }, [orderType]);

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
      
      const orderKey = (orderType === 'sales' ? soId : null) || woId;
      const newWO = {
          id: woId,
          woNum: woId,
          displayId: woId,
          orderKey,
          quoteId: null,
          salesOrderId: orderType === 'sales' ? soId : null,
          orderType: orderType,
          type: orderType, // kept for this card's existing reads
          soId: orderType === 'sales' ? soId : 'N/A',
          customer: orderType === 'sales' ? customer : 'Internal Stock',
          customerName: orderType === 'sales' ? customer : 'Internal Stock',
          clientName: orderType === 'sales' ? customer : 'Internal Stock',
          reqDate: reqDate || getThreeWeeksOut(),
          recipe: recipe,
          totalParts: totalPartsCalc,
          partsList: [],
          currentPhase: 'Setup',
          stepStatus: 'Pending',
          currentStepIndex: 0,
          tasks: makeFullTasks(),
          machineAssigned: null,
          redlineAlert: false,
          sentToPickPack: false,
          pickStatus: 'Pending',
          shopSiblingId: null,
          hasCustomSibling: false,
          customFabStatus: 'Pending',
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
    <div style={{ padding: '30px', fontFamily: 'var(--sans)' }}>

      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Direct Order Intake</h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => setOrderType('sales')} style={{ ...btnStyle, background: orderType === 'sales' ? 'var(--ink)' : 'var(--paper-2)', color: orderType === 'sales' ? '#fff' : 'var(--ink)' }}>Sales Order</button>
                  <button onClick={() => setOrderType('stock')} style={{ ...btnStyle, background: orderType === 'stock' ? 'var(--ink)' : 'var(--paper-2)', color: orderType === 'stock' ? '#fff' : 'var(--ink)' }}>Stock Order</button>
              </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '20px', alignItems: 'end' }}>
              <div><label style={labelStyle}>Work Order #</label><input value={woId} onChange={e=>setWoId(e.target.value)} style={inputStyle} /></div>
              
              {orderType === 'sales' && (
                  <>
                      <div><label style={labelStyle}>Sales Order #</label><input value={soId} onChange={e=>setSoId(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Customer</label><input value={customer} onChange={e=>setCustomer(e.target.value)} style={inputStyle} /></div>
                  </>
              )}
              
              <div>
                  <label style={labelStyle}>Finish Recipe</label>
                  <select value={recipe} onChange={e=>setRecipe(e.target.value)} style={{...inputStyle, background: '#fff'}}>
                      <option value="">Select Finish...</option>
                      {recipes && Object.keys(recipes).map(rCode => (
                          <option key={rCode} value={rCode}>{rCode}</option>
                      ))}
                  </select>
              </div>

              {orderType === 'stock' ? (
                  <div><label style={labelStyle}>Total Parts</label><input type="number" value={qty} onChange={e=>setQty(e.target.value)} style={inputStyle} /></div>
              ) : (
                  <>
                      <div><label style={labelStyle}>Poles</label><input type="number" value={poles} onChange={e=>setPoles(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Finials</label><input type="number" value={finials} onChange={e=>setFinials(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Rings</label><input type="number" value={rings} onChange={e=>setRings(e.target.value)} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Brackets</label><input type="number" value={brackets} onChange={e=>setBrackets(e.target.value)} style={inputStyle} /></div>
                  </>
              )}

              <div><label style={labelStyle}>Required Date</label><input type="date" value={reqDate} onChange={e=>setReqDate(e.target.value)} style={inputStyle} /></div>
          </div>
          <button onClick={handleCreateOrder} style={{ ...btnStyle, marginTop: '24px', width: '100%', background: 'var(--brass)', color: '#fff' }}>Ingest to Queue</button>
      </div>

      <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderRadius: '2px' }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Work Order Queue</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={nukeQueue} style={{ padding: '12px 24px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Nuke Queue</button>
            <button onClick={() => setAiOptimized(!aiOptimized)} style={{ padding: '12px 24px', background: aiOptimized ? 'var(--ink)' : '#fff', color: aiOptimized ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                {aiOptimized ? 'AI Batching: Active' : 'Activate AI Batching'}
            </button>
        </div>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
        {pendingOrders.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', gridColumn: '1/-1', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Queue is empty.</div>
        ) : (
          pendingOrders.map(wo => (
            <div key={wo.id} style={{...cardStyle, borderLeft: aiOptimized ? '4px solid var(--brass)' : '4px solid var(--ink)'}}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--ink)', fontWeight: 500 }}>
                        WO: {wo.woNum || wo.displayId || wo.id}
                        {(wo.type === 'sales' || wo.soNum) && <span style={{color:'var(--ink-soft)', fontSize:'0.85rem'}}> (SO: {wo.soId || wo.soNum})</span>}
                    </strong>
                    <span style={{ background: 'var(--paper)', padding: '4px 8px', fontSize: '0.85rem', fontFamily: 'var(--mono)', textTransform: 'uppercase', border: '1px solid var(--line)', color: 'var(--ink)' }}>{wo.recipe || wo.color}</span>
                </div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '12px' }}><span style={{color:'var(--ink-soft)'}}>Customer:</span> {wo.customer || wo.clientName || 'N/A'}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}><span style={{color:'var(--ink-soft)'}}>Req Date:</span> <span style={{ fontWeight: 500 }}>{wo.reqDate || 'ASAP'}</span></div>
                
                <div style={{ fontSize: '0.85rem', lineHeight: '1.6', color: 'var(--ink)' }}>
                    <span style={{color:'var(--ink-soft)'}}>Type:</span> {(wo.type || wo.itemName || 'Custom').toUpperCase()} | <span style={{color:'var(--ink-soft)'}}>Total Parts:</span> {wo.totalParts || wo.qty || 1} <br/>
                    {wo.type === 'sales' && (
                        <span style={{color: 'var(--ink-soft)'}}>
                            (Poles: {wo.poles?.qty || 0}, Fin: {wo.smallParts?.fin || 0}, Rng: {wo.smallParts?.rng || 0}, Brk: {wo.smallParts?.brk || 0})
                        </span>
                    )}
                    {wo.dimensions && (
                        <div style={{ fontWeight: 500, marginTop: '8px', fontSize: '0.85rem', color: 'var(--ink)' }}>
                            Item Dimensions: {wo.dimensions.length}L x {wo.dimensions.width}W x {wo.dimensions.height}H
                        </div>
                    )}
                </div>

                {wo.hasCustomSibling && (() => {
                    const cf = wo.customFabStatus || 'Pending';
                    const cfColor = cf === 'Complete' ? 'var(--ink)' : (cf === 'In Process' ? 'var(--brass)' : 'var(--ink-soft)');
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px', padding: '10px 12px', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Custom Parts (Shop)</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, color: cfColor }}>● {cf}</span>
                        </div>
                    );
                })()}
                
                <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                    <button onClick={() => setActiveSpecs(wo)} style={{ ...btnStyle, flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>Specs</button>
                    {wo.quoteId && <button onClick={() => setCfgQuote(wo.quoteId)} style={{ ...btnStyle, flex: 1, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>🔍 View Item</button>}
                    {wo.stepStatus === "Pending" ? (
                        <button onClick={() => startSetup(wo)} style={{ ...btnStyle, flex: 2, background: 'transparent', border: '1px solid var(--ink)', color: 'var(--ink)' }}>Start Setup</button>
                    ) : (
                        <button onClick={() => stageToFloor(wo)} style={{ ...btnStyle, flex: 2, background: 'var(--ink)', color: '#fff' }}>Stage to Floor</button>
                    )}
                </div>
            </div>
          ))
        )}
      </div>

      {cfgQuote && <ConfiguredItemViewer quoteId={cfgQuote} onClose={() => setCfgQuote(null)} />}

      {activeSpecs && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ background: '#fff', padding: '40px', borderRadius: '2px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px' }}>
                      <h2 style={{ color: 'var(--ink)', margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>Job Specs: {activeSpecs.woNum || activeSpecs.displayId || activeSpecs.id}</h2>
                      <button onClick={() => setActiveSpecs(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '30px' }}>
                      {activeSpecs.imageUrl && (
                          <div style={{ flex: 1, background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px' }}>
                              <img src={activeSpecs.imageUrl} alt="Part" style={{ width: '100%', objectFit: 'contain' }}/>
                          </div>
                      )}
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                          <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Client</div>
                              <div style={{ fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>{activeSpecs.clientName || activeSpecs.customer || 'N/A'}</div>
                          </div>
                          
                          {activeSpecs.note && (
                              <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)' }}>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '8px' }}>Client / RFI Notes</div>
                                  <div style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap', color: 'var(--ink)', lineHeight: '1.5' }}>{activeSpecs.note}</div>
                              </div>
                          )}
                          
                          {activeSpecs.cpqSpecs && Object.keys(activeSpecs.cpqSpecs).length > 0 && (
                              <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>CPQ Build Specs</div>
                                  {Object.entries(activeSpecs.cpqSpecs).map(([k, v]) => (
                                      <div key={k} style={{ fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                                          <span style={{ color: 'var(--ink-soft)' }}>{k}:</span><span style={{ fontWeight: 500, color: 'var(--ink)' }}>{v}</span>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {!activeSpecs.imageUrl && !activeSpecs.note && (!activeSpecs.cpqSpecs || Object.keys(activeSpecs.cpqSpecs).length === 0) && (
                              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>
                                  No extended specifications or client notes attached to this Work Order.
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default SetupQueue;