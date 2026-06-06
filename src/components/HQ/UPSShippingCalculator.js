// Ensure this theme object is accessible in your file (or export it from HQ.js)
const theme = {
  paper: '#faf8f4',
  paper2: '#f2efe8',
  ink: '#1c1a16',
  inkSoft: '#524e46',
  brass: '#b08d57',
  line: 'rgba(28,26,22,.14)',
  serif: "'Cormorant Garamond', Georgia, serif",
  sans: "'Inter', -apple-system, sans-serif",
  mono: "'IBM Plex Mono', monospace"
};

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '10px 20px', fontFamily: theme.sans, color: theme.ink }}>
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '30px', paddingBottom: '20px', borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ backgroundColor: theme.ink, color: '#fff', fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '2px', letterSpacing: '0.1em', fontFamily: theme.mono }}>
          UPS
        </div>
        <div>
          <h2 style={{ fontFamily: theme.serif, margin: '0 0 4px 0', fontSize: '1.5rem', fontWeight: 500, color: theme.ink }}>
            Net Shipping Calculator
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: theme.inkSoft, fontFamily: theme.sans }}>
            Contract D001305131 · Origin: High Point, NC 27260
          </p>
        </div>
      </div>

      {/* Service Selection */}
      <p style={{ fontSize: '10px', fontWeight: 600, color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px', fontFamily: theme.mono }}>
        Service Level
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '30px' }}>
        {SERVICES.map(svc => {
          const isActive = selectedService === svc.key;
          return (
            <button
              key={svc.key}
              onClick={() => handleServiceSelect(svc.key)}
              style={{
                textAlign: 'left',
                padding: '12px 16px',
                borderRadius: '2px',
                border: isActive ? `1px solid ${theme.brass}` : `1px solid ${theme.line}`,
                backgroundColor: isActive ? theme.paper2 : '#fff',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.04)' : 'none'
              }}
              onMouseOver={(e) => { if(!isActive) e.currentTarget.style.borderColor = theme.brass }}
              onMouseOut={(e) => { if(!isActive) e.currentTarget.style.borderColor = theme.line }}
            >
              <div style={{ fontWeight: 500, fontSize: '0.9rem', color: theme.ink, marginBottom: '4px' }}>{svc.label}</div>
              <div style={{ fontSize: '0.75rem', color: theme.inkSoft }}>{svc.sub}</div>
            </button>
          )
        })}
      </div>

      {/* Package Inputs */}
      <p style={{ fontSize: '10px', fontWeight: 600, color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px', fontFamily: theme.mono }}>
        Package Details
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        
        {/* Weight */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '6px' }}>Actual Wt (lbs)</label>
          <input
            type="number" min="0.1" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontSize: '1rem', fontFamily: theme.mono, outline: 'none', boxSizing: 'border-box' }}
            onFocus={(e) => e.target.style.borderColor = theme.brass}
            onBlur={(e) => e.target.style.borderColor = theme.line}
          />
        </div>

        {/* Quantity */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '6px' }}>Quantity</label>
          <input
            type="number" min="1" step="1" value={qty} onChange={e => setQty(e.target.value)} onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontSize: '1rem', fontFamily: theme.mono, outline: 'none', boxSizing: 'border-box' }}
            onFocus={(e) => e.target.style.borderColor = theme.brass}
            onBlur={(e) => e.target.style.borderColor = theme.line}
          />
        </div>

        {/* ZIP Code */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '6px' }}>Dest. ZIP</label>
          <input
            type="text" maxLength={5} value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, ''))} onKeyDown={handleKeyDown}
            style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontSize: '1rem', fontFamily: theme.mono, outline: 'none', boxSizing: 'border-box' }}
            onFocus={(e) => e.target.style.borderColor = theme.brass}
            onBlur={(e) => e.target.style.borderColor = theme.line}
          />
        </div>

        {/* Address Type */}
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '6px' }}>Address Type</label>
          <select
            style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontSize: '0.9rem', backgroundColor: '#fff', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}
            onChange={e => {
              const isRes = e.target.value === 'residential';
              const current = SERVICES.find(s => s.key === selectedService);
              if (!current) return;
              if (isRes && current.com === true) {
                const resVariant = selectedService.replace('-c', '-r').replace(/^gc$/, 'gr').replace(/^3ds-c$/, '3ds-r').replace(/^2da-c$/, '2da-r').replace(/^ndas-c$/, 'ndas-r').replace(/^nda-c$/, 'nda-r');
                if (SERVICES.find(s => s.key === resVariant)) setSelectedService(resVariant);
              } else if (!isRes && current.com === false) {
                const comVariant = selectedService.replace('-r', '-c').replace(/^gr$/, 'gc').replace(/^3ds-r$/, '3ds-c').replace(/^2da-r$/, '2da-c').replace(/^ndas-r$/, 'ndas-c').replace(/^nda-r$/, 'nda-c');
                if (SERVICES.find(s => s.key === comVariant)) setSelectedService(comVariant);
              }
            }}
            value={SERVICES.find(s => s.key === selectedService)?.com === false ? 'residential' : 'commercial'}
          >
            <option value="commercial">Commercial</option>
            <option value="residential">Residential</option>
          </select>
        </div>
      </div>

      {/* Box Dimensions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '8px' }}>
        {[['dimL', dimL, setDimL, 'Length (in)'], ['dimW', dimW, setDimW, 'Width (in)'], ['dimH', dimH, setDimH, 'Height (in)']].map(([id, val, setter, lbl]) => (
          <div key={id}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: theme.inkSoft, marginBottom: '6px' }}>{lbl}</label>
            <input
              type="number" min="0" step="0.5" value={val} onChange={e => setter(e.target.value)} onKeyDown={handleKeyDown} placeholder="0"
              style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontSize: '1rem', fontFamily: theme.mono, outline: 'none', boxSizing: 'border-box' }}
              onFocus={(e) => e.target.style.borderColor = theme.brass}
              onBlur={(e) => e.target.style.borderColor = theme.line}
            />
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.75rem', color: theme.inkSoft, marginBottom: '30px' }}>
        DIM divisor: <strong style={{ color: theme.ink }}>166</strong> (Contract rate). Leave blank to skip.
      </p>

      {/* Calculate Button */}
      <button
        onClick={calculate}
        style={{ width: '100%', padding: '16px', background: theme.ink, color: '#fff', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', fontFamily: theme.mono, border: 'none', cursor: 'pointer', transition: 'background 0.2s', borderRadius: '2px' }}
        onMouseOver={(e) => e.currentTarget.style.background = theme.brass}
        onMouseOut={(e) => e.currentTarget.style.background = theme.ink}
      >
        Calculate Expected Cost
      </button>

      {/* Error State */}
      {error && (
        <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#fff', border: `1px solid ${theme.brass}`, color: theme.ink, fontSize: '0.85rem', borderRadius: '2px' }}>
          {error}
        </div>
      )}

      {/* Results State */}
      {result && (
        <div style={{ marginTop: '30px', padding: '30px', backgroundColor: '#fff', border: `1px solid ${theme.line}`, borderRadius: '2px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
          <p style={{ fontSize: '0.85rem', color: theme.inkSoft, margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {result.svc.label} · {result.svc.sub}
          </p>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
            {result.quantity > 1 ? (
              <>
                <span style={{ fontSize: '2.5rem', fontFamily: theme.serif, color: theme.ink, lineHeight: 1 }}>${result.totalRate.toFixed(2)}</span>
                <span style={{ fontSize: '0.9rem', color: theme.inkSoft }}>total ({result.quantity} pkgs)</span>
                <span style={{ fontSize: '1.2rem', color: theme.inkSoft, marginLeft: 'auto' }}>${result.rate.toFixed(2)} <span style={{ fontSize: '0.8rem' }}>/ea</span></span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '2.5rem', fontFamily: theme.serif, color: theme.ink, lineHeight: 1 }}>${result.rate.toFixed(2)}</span>
                <span style={{ fontSize: '0.9rem', color: theme.inkSoft }}>net shipping</span>
              </>
            )}
          </div>

          <p style={{ fontSize: '0.75rem', color: theme.inkSoft, margin: '0 0 20px 0' }}>
            Includes 7% discount from Small Business Rates {result.quantity > 1 && ` · Each package rated individually`}
          </p>

          {/* Conditional Alerts */}
          {result.dimApplied && (
            <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: theme.paper2, borderLeft: `3px solid ${theme.brass}`, fontSize: '0.8rem', color: theme.ink }}>
              <strong>Note:</strong> Dimensional weight ({result.dimWeight.toFixed(1)} lbs) exceeds actual weight ({result.actualWeight} lbs). Billed at DIM weight.
            </div>
          )}

          {result.hwtEligible && (
            <div style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: theme.paper, border: `1px solid ${theme.line}`, fontSize: '0.8rem', color: theme.ink }}>
              <strong>Hundredweight (HWT) Eligible:</strong> {result.quantity} packages totaling {result.totalCombinedWeight.toFixed(0)} lbs to the same address qualifies for Tier 06 HWT pricing. Check HWT charts for potential savings over the per-package rate.
            </div>
          )}

          {/* Data Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', marginTop: '20px', paddingTop: '20px', borderTop: `1px solid ${theme.line}` }}>
            {[
              ['Billable Wt', `${result.billableWeight.toFixed(1)} lbs`],
              result.quantity > 1 ? ['Total Wt', `${result.totalCombinedWeight.toFixed(0)} lbs`] : ['Zone Code', result.zoneName],
              ['Service Zone', `Zone ${result.serviceZone}`],
              result.resSurcharge > 0 ? ['Res. Surcharge', `$${result.resSurcharge.toFixed(2)} (incl)`] : ['Fuel Surcharge', 'Waived']
            ].map(([label, value], idx) => (
              <div key={idx}>
                <p style={{ margin: '0 0 4px 0', fontSize: '0.7rem', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: theme.mono }}>{label}</p>
                <p style={{ margin: 0, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{value}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: `1px dotted ${theme.line}`, fontSize: '0.75rem', color: theme.inkSoft, lineHeight: 1.5 }}>
            <span style={{ color: theme.ink, fontWeight: 500 }}>Waived Surcharges:</span> Fuel Surcharge · Delivery Area Surcharge (DAS) · Address Correction · 3rd-Party Billing · 2 lb Weight Variance
          </div>
        </div>
      )}
    </div>
  );
}