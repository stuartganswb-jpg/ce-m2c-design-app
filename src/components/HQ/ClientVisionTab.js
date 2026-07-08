import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc } from "firebase/firestore";

import VisionHardware from './VisionHardware';
import VisionPillow from './VisionPillow';
import VisionLighting from './VisionLighting';

// Searchable customer combobox — replaces the native <select>, whose keystroke type-ahead jumped to
// the first match per letter and reset its buffer mid-word (typing "Melanie…" bounced Mel G → Arvita).
// Type freely, the list filters live (name OR id, contains-match) and sorts ALPHABETICALLY by name.
const CustomerCombobox = ({ value, onChange, customers, placeholder }) => {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const c = value ? customers.find(x => x.id === value) : null;
        setSearch(c ? `${c.name} (${c.id})` : '');
    }, [value, customers]);
    const term = search.toLowerCase();
    const list = [...customers]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .filter(c => !term || String(c.name || '').toLowerCase().includes(term) || String(c.id || '').toLowerCase().includes(term));
    return (
        <div style={{ position: 'relative' }}>
            <input
                type="text" value={search} placeholder={placeholder}
                onChange={e => { setSearch(e.target.value); setOpen(true); if (e.target.value === '') onChange(''); }}
                onFocus={e => { setOpen(true); e.target.select(); }}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: 'var(--paper)', boxSizing: 'border-box' }}
            />
            {open && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '260px', overflowY: 'auto', zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {list.length === 0 && <div style={{ padding: '12px', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No matches…</div>}
                    {list.map(c => (
                        <div key={c.id} onMouseDown={() => { onChange(c.id); setSearch(`${c.name} (${c.id})`); setOpen(false); }}
                            style={{ padding: '11px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: value === c.id ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', fontSize: '0.9rem' }}>
                            {c.name} <span style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>({c.id})</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const CATEGORIES_BY_BRAND = {
  ce: [{ id: 'HARDWARE', label: 'Drapery Hardware' }],
  m2c: [{ id: 'HARDWARE', label: 'Drapery Hardware' }, { id: 'LIGHTING', label: 'Custom Lighting' }],
  uniquity: [{ id: 'PILLOW', label: 'Custom Pillow Assembly' }],
  leyla: [{ id: 'JEWELRY', label: 'Custom Jewelry Configurator' }]
};

const ClientVisionTab = ({ currentUser, activeBrand, cpqActiveItems }) => {
  const [visionCategory, setVisionCategory] = useState('HARDWARE');
  
  // SHARED GLOBAL STATE
  const [visionConfigs, setVisionConfigs] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  const [liveCustomers, setLiveCustomers] = useState([]);
  const [globalLists, setGlobalLists] = useState({ 
      pillowSizes: ['12x20 Lumbar', '18x18 Square', '22x22 Square'], 
      fillTypes: ['DOWN', 'POLY'], 
      flangeStyles: ['NONE', 'FLANGE'], 
      stitchTypes: ['STANDARD', 'RAILROAD', 'KNIFE_EDGE', 'FRINGE'] 
  });

  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);

  // --- MASTER SESSION CONTROLLER ---
  const [sessionCustomerId, setSessionCustomerId] = useState('');
  const [sessionJobName, setSessionJobName] = useState('');
  const [sessionQuoteId, setSessionQuoteId] = useState(null);

  useEffect(() => {
      const allowed = CATEGORIES_BY_BRAND[activeBrand] || [{ id: 'HARDWARE', label: 'Drapery Hardware' }];
      if (!allowed.find(c => c.id === visionCategory)) {
          setVisionCategory(allowed[0].id);
      }
  }, [activeBrand, visionCategory]);

  useEffect(() => {
      if (!activeBrand) return;
      const q = query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand));
      return onSnapshot(q, (snap) => setVisionConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [activeBrand]);

  useEffect(() => {
      if (!activeBrand) return;
      
      const unsubParts = onSnapshot(query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory")), (snap) => {
          let docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setLibraryParts(docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand))));
      });
      
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { 
          if (docSnap.exists()) {
              const data = docSnap.data();
              setGlobalLists(prev => ({ ...prev, pillowSizes: data.pillowSizes || prev.pillowSizes, fillTypes: data.fillTypes || prev.fillTypes, flangeStyles: data.flangeStyles || prev.flangeStyles, stitchTypes: data.stitchTypes || prev.stitchTypes }));
          }
      });

      const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if(snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
      const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      // 🚀 FIX: Brand Isolation Filter applied to the master session dropdown
      const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
          const customers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => 
              r.type === 'CUSTOMER' && 
              (r.brandId === activeBrand || (r.sharedBrands && r.sharedBrands.includes(activeBrand)))
          );
          setLiveCustomers(customers);
      });

      return () => { unsubParts(); unsubLists(); unsubFinishes(); unsubOutsource(); unsubDynamic(); unsubCrm(); };
  }, [activeBrand]);

  // Derive queued lines for the active session to display the count
  const queuedLines = visionConfigs.filter(c => c.masterQuoteId === sessionQuoteId);

  const handlePushToCPQ = () => {
      if (!sessionQuoteId) return;
      
      // 1. Set the handoff protocol in local storage for CPQTab to catch on mount
      localStorage.setItem('hq_active_quote_session', sessionQuoteId);
      
      // 2. Dispatch event to parent router to switch tabs automatically
      window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'CPQ' }));
  };

  const activeSession = {
      quoteId: sessionQuoteId,
      customerId: sessionCustomerId,
      jobName: sessionJobName
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {/* GLOBAL ROUTER HEADER */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Spatial Overlay & Dynamic Environments</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Client Vision System</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Scene Type:</label>
          <select value={visionCategory} onChange={(e) => setVisionCategory(e.target.value)} style={{ padding: '12px 16px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: 'var(--paper-2)', color: 'var(--ink)', cursor: 'pointer' }}>
              {(CATEGORIES_BY_BRAND[activeBrand] || CATEGORIES_BY_BRAND['ce']).map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
              ))}
          </select>
        </div>
      </div>

      {/* SESSION CONTROLLER (THE MULTI-ROOM CART INITIATOR) */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px 24px', display: 'flex', alignItems: 'flex-end', gap: '20px', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' }}>1. Select Customer (Initializes Session)</label>
              <CustomerCombobox
                  value={sessionCustomerId}
                  customers={liveCustomers}
                  placeholder="Type to search customers…"
                  onChange={(id) => {
                      setSessionCustomerId(id);
                      // Generate a new global quote ID the moment a customer is picked
                      if (!sessionQuoteId && id) setSessionQuoteId(`QUOTE-${Date.now()}`);
                      // Clear session if deselected
                      if (!id) setSessionQuoteId(null);
                  }}
              />
          </div>
          <div style={{ flex: 1 }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' }}>2. Project / Job Name (Optional)</label>
              <input
                  type="text"
                  placeholder="e.g. Master Suite Reno"
                  value={sessionJobName}
                  onChange={e => setSessionJobName(e.target.value)}
                  disabled={!sessionQuoteId}
                  style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box', background: !sessionQuoteId ? 'transparent' : '#fff', cursor: !sessionQuoteId ? 'not-allowed' : 'text' }}
              />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '220px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px dashed var(--line)', paddingBottom: '6px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Lines Queued:</span>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: queuedLines.length > 0 ? 'var(--brass)' : 'var(--ink-soft)' }}>{queuedLines.length}</span>
              </div>
              <button
                  onClick={handlePushToCPQ}
                  disabled={queuedLines.length === 0}
                  style={{ padding: '12px 16px', background: queuedLines.length > 0 ? 'var(--ink)' : 'var(--paper)', color: queuedLines.length > 0 ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: queuedLines.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
              >
                  Push Configs to CPQ 
              </button>
          </div>
      </div>

      {/* RENDER ACTIVE MODULE - PASSING DOWN THE SESSION STATE */}
      {visionCategory === 'HARDWARE' && (
          <VisionHardware 
              currentUser={currentUser} 
              activeBrand={activeBrand} 
              visionConfigs={visionConfigs.filter(c => c.category === 'HARDWARE')} 
              activeSession={activeSession}
          />
      )}

      {visionCategory === 'PILLOW' && (
          <VisionPillow 
              currentUser={currentUser} 
              activeBrand={activeBrand} 
              visionConfigs={visionConfigs.filter(c => c.category === 'PILLOW')} 
              libraryParts={libraryParts} 
              globalLists={globalLists} 
              activeSession={activeSession}
          />
      )}

      {visionCategory === 'LIGHTING' && (
          <VisionLighting 
              currentUser={currentUser} 
              activeBrand={activeBrand} 
              globalFinishes={globalFinishes}
              outsourceFinishes={outsourceFinishes}
              dynamicAssets={dynamicAssets}
              activeSession={activeSession}
          />
      )}
    </div>
  );
};

export default ClientVisionTab;