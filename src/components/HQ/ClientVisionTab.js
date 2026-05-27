import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc } from "firebase/firestore";

import VisionHardware from './VisionHardware';
import VisionPillow from './VisionPillow';
import VisionLighting from './VisionLighting'; // 🚀 UNCOMMENTED

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
  const [globalLists, setGlobalLists] = useState({ 
      pillowSizes: ['12x20 Lumbar', '18x18 Square', '22x22 Square'], 
      fillTypes: ['DOWN', 'POLY'], 
      flangeStyles: ['NONE', 'FLANGE'], 
      stitchTypes: ['STANDARD', 'RAILROAD', 'KNIFE_EDGE', 'FRINGE'] 
  });

  // 🚀 NEW DATA ARRAYS FOR ADVANCED CPQ/LIGHTING
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);

  // Ensure category is valid for current brand
  useEffect(() => {
      const allowed = CATEGORIES_BY_BRAND[activeBrand] || [{ id: 'HARDWARE', label: 'Drapery Hardware' }];
      if (!allowed.find(c => c.id === visionCategory)) {
          setVisionCategory(allowed[0].id);
      }
  }, [activeBrand, visionCategory]);

  // Fetch CPQ Drafts
  useEffect(() => {
      if (!activeBrand) return;
      const q = query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand));
      return onSnapshot(q, (snap) => setVisionConfigs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [activeBrand]);

  // Fetch Library Parts, Lists, & Custom CPQ Dictionaries
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

      // 🚀 NEW FETCHERS
      const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if(snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
      const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      return () => { unsubParts(); unsubLists(); unsubFinishes(); unsubOutsource(); unsubDynamic(); };
  }, [activeBrand]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* GLOBAL ROUTER HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>9. Client Vision System</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>SPATIAL OVERLAY & DYNAMIC ENVIRONMENTS</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>SCENE TYPE:</label>
          <select value={visionCategory} onChange={(e) => setVisionCategory(e.target.value)} style={{ padding: '8px', border: '2px solid #007bff', fontWeight: 'bold', outline: 'none', background: '#eafaf1', color: '#28a745' }}>
              {(CATEGORIES_BY_BRAND[activeBrand] || CATEGORIES_BY_BRAND['ce']).map(c => (
                  <option key={c.id} value={c.id}>{c.label.toUpperCase()}</option>
              ))}
          </select>
        </div>
      </div>

      {/* RENDER ACTIVE MODULE */}
      {visionCategory === 'HARDWARE' && (
          <VisionHardware currentUser={currentUser} activeBrand={activeBrand} visionConfigs={visionConfigs.filter(c => c.category === 'HARDWARE')} />
      )}

      {visionCategory === 'PILLOW' && (
          <VisionPillow currentUser={currentUser} activeBrand={activeBrand} visionConfigs={visionConfigs.filter(c => c.category === 'PILLOW')} libraryParts={libraryParts} globalLists={globalLists} />
      )}

      {/* 🚀 NEW LIGHTING MODULE ACTIVATED */}
      {visionCategory === 'LIGHTING' && (
          <VisionLighting 
              currentUser={currentUser} 
              activeBrand={activeBrand} 
              globalFinishes={globalFinishes}
              outsourceFinishes={outsourceFinishes}
              dynamicAssets={dynamicAssets}
          />
      )}
    </div>
  );
};

export default ClientVisionTab;