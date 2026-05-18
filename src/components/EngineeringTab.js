import React, { useState } from 'react';
import { db, storage } from '../firebase';
import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, query } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

const EngineeringTab = ({ currentUser, currentProjectData }) => {
  const [projectName, setProjectName] = useState("");
  const [approvals, setApprovals] = useState({ designer: false, technical: false, machinist: false });
  const [isArchived, setIsArchived] = useState(false);

  const toggleApproval = (role) => setApprovals(prev => ({ ...prev, [role]: !prev[role] }));
  const allApproved = approvals.designer && approvals.technical && approvals.machinist;

  const archiveAndClearWorkspace = async () => {
    if (!projectName) return alert("Enter Project Name!");
    if (!currentProjectData.isFinal) return alert("Wait! You must mark a revision as 'FINAL' on the Inception tab before archiving.");

    try {
      // 1. Save to Permanent Library
      await addDoc(collection(db, "Design_Library"), {
        projectName: projectName.toUpperCase(),
        finalImageUrl: currentProjectData.imageUrl,
        pins: currentProjectData.pins,
        approvedBy: currentUser,
        archivedAt: serverTimestamp(),
      });

      // 2. WIPE THE WORKSPACE (Deletes active revisions to start fresh)
      const q = query(collection(db, "project_images"));
      const snapshot = await getDocs(q);
      
      const deletePromises = snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        // Delete Firestore record
        await deleteDoc(doc(db, "project_images", docSnap.id));
        // Delete Storage file (optional, but keeps cloud clean)
        try {
          const fileRef = ref(storage, data.imageUrl);
          await deleteObject(fileRef);
        } catch(e) { console.log("File cleanup skipped or already gone."); }
      });

      // 3. Clear Markup Pins
      const pinSnap = await getDocs(collection(db, "markups"));
      const pinDeletes = pinSnap.docs.map(p => deleteDoc(doc(db, "markups", p.id)));

      await Promise.all([...deletePromises, ...pinDeletes]);

      setIsArchived(true);
      alert("Project Archived. Workspace cleared for next item.");
      window.location.reload(); // Refresh to clear local state
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'monospace' }}>
      <h2>STAGE 2: ENGINEERING SIGN-OFF</h2>
      <input 
        value={projectName} 
        onChange={(e) => setProjectName(e.target.value)} 
        placeholder="PROJECT NAME (RECALL ID)" 
        style={{ width: '100%', padding: '15px', border: '2px solid #000', marginBottom: '20px' }}
      />
      
      <div style={{ display: 'flex', gap: '20px' }}>
        {['designer', 'technical', 'machinist'].map(role => (
          <button key={role} onClick={() => toggleApproval(role)} style={{ flex: 1, padding: '20px', background: approvals[role] ? '#28a745' : '#000', color: '#fff' }}>
            {role.toUpperCase()}: {approvals[role] ? "APPROVED ✓" : "PENDING"}
          </button>
        ))}
      </div>

      {allApproved && !isArchived && (
        <button 
          onClick={archiveAndClearWorkspace} 
          style={{ marginTop: '30px', width: '100%', padding: '20px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}
        >
          CONFIRM ARCHIVE & WIPE WORKSPACE
        </button>
      )}
    </div>
  );
};

export default EngineeringTab;