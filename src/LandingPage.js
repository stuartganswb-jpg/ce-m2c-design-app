import React from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage = () => {
  const navigate = useNavigate();

  // CSS variables mapped directly from the new Classical Elements prototype
  const theme = {
    paper: '#faf8f4',
    ink: '#1c1a16',
    inkSoft: '#524e46',
    brass: '#b08d57',
    line: 'rgba(28,26,22,.14)',
    serif: "'Cormorant Garamond', Georgia, serif",
    sans: "'Inter', -apple-system, sans-serif",
    mono: "'IBM Plex Mono', monospace"
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: theme.paper, color: theme.ink, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: theme.sans, fontWeight: 300, WebkitFontSmoothing: 'antialiased' }}>
      
      {/* CENTRAL APP CONTROL PANEL */}
      <div style={{ background: '#fff', border: `1px solid ${theme.line}`, width: '100%', maxWidth: '480px', padding: '50px 40px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
        
        {/* PANEL HEADER */}
        <div style={{ paddingBottom: '30px', marginBottom: '30px', textAlign: 'center', borderBottom: `1px solid ${theme.line}` }}>
          <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>
            System Directory
          </span>
          <h1 style={{ fontFamily: theme.serif, margin: 0, fontSize: '2.2rem', fontWeight: 500, letterSpacing: '0.05em', color: theme.ink }}>
            Factory Portal
          </h1>
        </div>

        {/* WORKSPACE SELECTION LIST */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <HubButton 
            theme={theme}
            number="01"
            title="HQ Management Hub"
            onClick={() => {
              localStorage.setItem('hq_session', JSON.stringify({ name: 'Admin', pin: '1234', role: 'admin' }));
              navigate('/hq');
            }}
          />

          <HubButton 
            theme={theme}
            number="02"
            title="Shop Floor"
            subtitle="Fabrication & Milling"
            onClick={() => navigate('/shop-floor')}
          />

          <HubButton 
            theme={theme}
            number="03"
            title="Finishing Floor"
            subtitle="Recipes & Plating"
            onClick={() => navigate('/finishing-floor')}
          />

          <HubButton 
            theme={theme}
            number="04"
            title="Warehouse"
            subtitle="Pick & Pack"
            onClick={() => navigate('/pick-pack')}
          />

        </div>

        {/* FOOTER METADATA */}
        <div style={{ marginTop: '40px', paddingTop: '20px', borderTop: `1px solid ${theme.line}`, textAlign: 'center', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.18em', color: theme.inkSoft, textTransform: 'uppercase' }}>
          Local Node: Administrator
        </div>

      </div>
    </div>
  );
};

// Reusable Button Component for the Hub
const HubButton = ({ theme, number, title, subtitle, onClick }) => {
  return (
    <button 
      onClick={onClick}
      style={{ width: '100%', padding: '20px', background: 'transparent', border: `1px solid ${theme.line}`, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '20px', transition: 'all 0.3s ease' }}
      onMouseOver={(e) => { 
        e.currentTarget.style.borderColor = theme.brass;
        e.currentTarget.querySelector('.nav-arrow').style.transform = 'translateX(5px)';
        e.currentTarget.querySelector('.nav-arrow').style.color = theme.brass;
      }}
      onMouseOut={(e) => { 
        e.currentTarget.style.borderColor = theme.line;
        e.currentTarget.querySelector('.nav-arrow').style.transform = 'translateX(0)';
        e.currentTarget.querySelector('.nav-arrow').style.color = theme.inkSoft;
      }}
    >
      <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass, letterSpacing: '.1em' }}>
        [{number}]
      </span>
      <div style={{ flex: 1 }}>
        <span style={{ display: 'block', fontFamily: theme.sans, fontSize: '0.95rem', fontWeight: 400, color: theme.ink, letterSpacing: '0.02em' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ display: 'block', fontFamily: theme.serif, fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic', marginTop: '2px' }}>
            {subtitle}
          </span>
        )}
      </div>
      <span className="nav-arrow" style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft, transition: 'all 0.3s ease' }}>
        →
      </span>
    </button>
  );
};

export default LandingPage;