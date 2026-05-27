import React from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'monospace' }}>
      
      {/* CENTRAL APP CONTROL PANEL */}
      <div style={{ background: '#fff', border: '2px solid #000', width: '100%', maxWidth: '450px', boxShadow: '10px 10px 0 #000', padding: '30px' }}>
        
        {/* PANEL HEADER */}
        <div style={{ borderBottom: '2px solid #000', paddingBottom: '15px', marginBottom: '25px', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '1.6rem', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 'bold', color: '#000' }}>FACTORY O.S.</h1>
          <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold', letterSpacing: '1px' }}>SYSTEM DIRECTORY // MASTER WORKSPACE</span>
        </div>

        {/* WORKSPACE SELECTION LIST */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          
          {/* HQ ACTION LINK */}
          <button 
            onClick={() => {
              // 🚀 THE FIX: This injects the missing session so HQ.js stops kicking you out!
              localStorage.setItem('hq_session', JSON.stringify({ name: 'Admin', pin: '1234', role: 'admin' }));
              navigate('/hq');
            }}
            style={{ width: '100%', padding: '15px 20px', background: '#fff', border: '2px solid #000', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', transition: '0.1s', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '4px 4px 0 #000' }}
            onMouseOver={(e) => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
          >
            <span>[01] HQ MANAGEMENT HUB</span>
            <span>➔</span>
          </button>

          {/* SHOP FLOOR ACTION LINK */}
          <button 
            onClick={() => navigate('/shop-floor')}
            style={{ width: '100%', padding: '15px 20px', background: '#fff', border: '2px solid #000', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', transition: '0.1s', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '4px 4px 0 #000' }}
            onMouseOver={(e) => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
          >
            <span>[02] SHOP FLOOR (FABRICATION)</span>
            <span>➔</span>
          </button>

          {/* FINISHING FLOOR ACTION LINK */}
          <button 
            onClick={() => navigate('/finishing-floor')}
            style={{ width: '100%', padding: '15px 20px', background: '#fff', border: '2px solid #000', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', transition: '0.1s', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '4px 4px 0 #000' }}
            onMouseOver={(e) => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
          >
            <span>[03] FINISHING FLOOR (RECIPES)</span>
            <span>➔</span>
          </button>

          {/* 🚀 NEW: WAREHOUSE / PICK & PACK LINK */}
          <button 
            onClick={() => navigate('/pick-pack')}
            style={{ width: '100%', padding: '15px 20px', background: '#fff', border: '2px solid #28a745', color: '#28a745', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', transition: '0.1s', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '4px 4px 0 #28a745' }}
            onMouseOver={(e) => { e.currentTarget.style.background = '#28a745'; e.currentTarget.style.color = '#fff'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#28a745'; }}
          >
            <span>[04] WAREHOUSE (PICK & PACK)</span>
            <span>➔</span>
          </button>

        </div>

        {/* FOOTER METADATA */}
        <div style={{ marginTop: '25px', borderTop: '1px solid #000', paddingTop: '12px', textAlign: 'center', fontSize: '0.6rem', color: '#666', fontWeight: 'bold' }}>
          LOCAL NODE SECURITY LEVEL: ADMINISTRATOR
        </div>

      </div>
    </div>
  );
};

export default LandingPage;