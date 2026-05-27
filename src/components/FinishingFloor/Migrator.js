import React, { useState } from 'react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db as destinationDb } from '../../firebase'; // Your new unified database

// 1. Connect to the OLD Abandoned Database
const oldConfig = {
  apiKey: "AIzaSyC7ZZAEYvAXkvAMNTjlteVf4FsR40h-Z9E",
  authDomain: "ce-finishing-floor.firebaseapp.com",
  projectId: "ce-finishing-floor",
  storageBucket: "ce-finishing-floor.firebasestorage.app",
  messagingSenderId: "170548146592",
  appId: "1:170548146592:web:c3c802b5a8e36c18f9f4c5"
};

// We name it "OldProject" so it doesn't collide with your main app
const oldApp = initializeApp(oldConfig, "OldProject");
const sourceDb = getFirestore(oldApp);

// 2. The exact list of collections you want to copy
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
        // Get all documents from the old database
        const snapshot = await getDocs(collection(sourceDb, colName));
        let count = 0;
        
        // Loop through them and copy them to the new database
        for (const document of snapshot.docs) {
          // setDoc ensures we keep the exact same Document ID (like '1032' for the user)
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
    
    setStatus("✅ MIGRATION COMPLETE! All data copied.");
  };

  return (
    <div style={{ padding: '40px', background: '#fff', border: '4px solid #000', margin: '40px', textAlign: 'center' }}>
      <h2>🚛 DATABASE MOVING TRUCK</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>This will copy all historical data from ce-finishing-floor into ce-m2c-design-collab.</p>
      <button 
        onClick={runMigration} 
        style={{ padding: '15px 30px', background: '#007bff', color: '#fff', fontSize: '1.2rem', fontWeight: 'bold', cursor: 'pointer', border: 'none' }}
      >
        START MIGRATION
      </button>
      <h3 style={{ marginTop: '20px', color: status.includes('ERROR') ? 'red' : 'green' }}>{status}</h3>
    </div>
  );
}