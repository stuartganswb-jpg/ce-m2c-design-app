// src/components/FinishingFloor/finishingStyles.js

export const inputStyle = { 
    width: '100%', 
    padding: '12px', 
    border: '1px solid var(--line)', 
    boxSizing: 'border-box', 
    fontFamily: 'var(--sans)', 
    fontSize: '0.95rem',
    outline: 'none',
    background: '#fff'
};

export const labelStyle = { 
    fontFamily: 'var(--mono)', 
    fontSize: '10px', 
    textTransform: 'uppercase', 
    color: 'var(--ink-soft)', 
    display: 'block', 
    marginBottom: '8px', 
    letterSpacing: '.1em' 
};

export const cardStyle = { 
    background: '#fff', 
    border: '1px solid var(--line)', 
    padding: '24px', 
    boxShadow: '0 4px 12px rgba(0,0,0,0.02)', 
    marginBottom: '20px',
    borderRadius: '2px'
};

export const btnStyle = { 
    padding: '12px 24px', 
    background: 'var(--ink)', 
    color: '#fff', 
    border: 'none', 
    cursor: 'pointer', 
    fontFamily: 'var(--mono)', 
    fontSize: '10px', 
    textTransform: 'uppercase', 
    letterSpacing: '.1em', 
    transition: 'all 0.2s ease' 
};

export const sectionHeaderStyle = { 
    margin: '0 0 20px 0', 
    fontFamily: 'var(--serif)', 
    fontSize: '1.4rem', 
    fontWeight: 500, 
    color: 'var(--ink)', 
    borderBottom: '1px solid var(--line)', 
    paddingBottom: '10px' 
};