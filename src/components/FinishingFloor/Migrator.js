import React, { useState } from 'react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db as destinationDb } from '../../firebase'; 

// 1. Connect to the OLD Abandoned Database
const oldConfig = {
  apiKey: "AIzaSyC7ZZAEYvAXkvAMNTjlteVf4FsR40h-Z9E",
  authDomain: "ce-finishing-floor.firebaseapp.com",
  projectId: "ce-finishing-floor",
  storageBucket: "ce-finishing-floor.firebasestorage.app",
  messagingSenderId: "170548146592",
  appId: "1:170548146592:web:c3c802b5a8e36c18f9f4c5"
};

const oldApp = initializeApp(oldConfig, "OldProject");
const sourceDb = getFirestore(oldApp);

const COLLECTIONS = [
  "fin_config", "fin_logs", "fin_messaging", "fin_paint_profiles", 
  "fin_pots", "fin_recipes", "fin_supplies", "fin_users", "fin_workorders"
];

export default function Migrator() {
  const [status, setStatus] = useState("Ready to migrate...");

  const runMigration = async () => {
    const confirm = window.confirm("Are you sure? This will copy all data from the old project to the new one.");
    if (!confirm) return;

    for (const colName of COLLECTIONS) {
      setStatus(`Copying ${colName}...`);
      try {
        const snapshot = await getDocs(collection(sourceDb, colName));
        let count = 0;
        
        for (const document of snapshot.docs) {
          await setDoc(doc(destinationDb, colName, document.id), document.data());
          count++;
        }
        console.log(`Successfully migrated ${count} documents for ${colName}`);
      } catch (err) {
        console.error(`Failed on ${colName}`, err);
        setStatus(`ERROR on ${colName}. Check console.`);
        return;
      }
    }
    
    setStatus("Migration Complete. All data copied.");
  };

  return (
    <div style={{ padding: '60px', background: '#fff', border: '1px solid var(--line)', margin: '40px auto', maxWidth: '600px', textAlign: 'center', fontFamily: 'var(--sans)', borderRadius: '2px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: 'var(--ink)', margin: '0 0 16px 0', fontWeight: 500 }}>Database Moving Truck</h2>
      <p style={{ color: 'var(--ink-soft)', marginBottom: '40px', fontSize: '1rem', lineHeight: '1.6' }}>This tool will copy all historical application data from <strong>ce-finishing-floor</strong> into the unified <strong>ce-m2c-design-collab</strong> environment.</p>
      
      <button 
        onClick={runMigration} 
        style={{ padding: '16px 32px', background: 'var(--ink)', color: '#fff', fontSize: '11px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', border: 'none', transition: 'background 0.2s', width: '100%' }}
      >
        Start Migration
      </button>
      
      <div style={{ marginTop: '30px', padding: '16px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: status.includes('ERROR') ? '#d9534f' : (status.includes('Complete') ? 'var(--brass)' : 'var(--ink)') }}>
            {status}
          </h3>
      </div>
    </div>
  );
}