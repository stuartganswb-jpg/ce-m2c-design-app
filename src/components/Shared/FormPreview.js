import React from 'react';
import Barcode from './Barcode';

// Live, print-style preview of a branded document (Sales Order / Packing List / Invoice / Quote …).
// Mirrors the look we want on the real forms: serif headings, mono labels, sans body, light-grey
// shaded header blocks to break up the metadata, and the document number printed + barcoded at the
// bottom (the spine that ties the order to NetSuite's quote → fulfillment → packing → invoice chain).

const BRAND_NAMES = { m2c: 'M2C Studio', ce: 'Classical Elements', uniquity: 'Uniquity', leyla: 'Leyla' };
const TITLES = { QUOTE: 'Quotation', SALES_ORDER: 'Sales Order', WORK_ORDER: 'Work Order', PACKING_SLIP: 'Packing List', INVOICE: 'Invoice', FACTORY_ROUTER: 'Factory Router' };

// Sample lines so the layout reads like a real document in the preview.
const SAMPLE_LINES = [
  { item: 'BRIMAR-FR-1IN', desc: '1" French Return Pole — 96" finished, Antique Brass', qty: 2, price: 412.0 },
  { item: 'HCUMLPB410EB', desc: 'Center Passing Bracket, Oil-Rubbed Bronze', qty: 3, price: 38.5 },
  { item: 'RING-FIPR-225', desc: 'Flat Inset Premium Ring 2.25" (set of 7)', qty: 4, price: 64.0 },
];

const money = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FormPreview = ({ type = 'SALES_ORDER', brand = 'ce', logoUrl, header, footer, terms, docNumber = 'SO10293' }) => {
  const title = (TITLES[type] || type.replace(/_/g, ' ')).toUpperCase();
  const company = BRAND_NAMES[brand] || brand?.toUpperCase() || 'Company';
  const isPacking = type === 'PACKING_SLIP';
  const showMoney = !isPacking && type !== 'WORK_ORDER' && type !== 'FACTORY_ROUTER';
  const subtotal = SAMPLE_LINES.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = showMoney ? subtotal * 0.0875 : 0;
  const total = subtotal + tax;

  const label = { fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' };
  const cell = { padding: '9px 12px', fontFamily: 'var(--sans)', fontSize: '12px', color: 'var(--ink)' };
  // Light-grey shaded block used for every header metadata field, to break the form up.
  const shaded = { background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px', padding: '12px 14px' };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)', width: '100%', maxWidth: '820px', margin: '0 auto', padding: '44px 48px', fontFamily: 'var(--sans)', color: 'var(--ink)' }}>

      {/* Masthead */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid var(--ink)', paddingBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {logoUrl
            ? <img src={logoUrl} alt={company} style={{ maxHeight: '52px', maxWidth: '200px' }} />
            : <div style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem', fontWeight: 500, letterSpacing: '.02em' }}>{company}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, lineHeight: 1, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '6px' }}>NO. {docNumber}</div>
        </div>
      </div>

      {/* Optional header note */}
      {header ? <div style={{ fontFamily: 'var(--sans)', fontSize: '12px', fontStyle: 'italic', color: 'var(--ink-soft)', margin: '16px 0 0' }}>{header}</div> : null}

      {/* Shaded header metadata blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', margin: '22px 0' }}>
        <div style={shaded}>
          <span style={label}>Bill To</span>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>Upholstery Loft & Decor<br />1420 Market Street<br />Denver, CO 80202</div>
        </div>
        <div style={shaded}>
          <span style={label}>Ship To</span>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>Master Suite Reno<br />88 Lakeshore Dr<br />Aspen, CO 81611</div>
        </div>
        <div style={shaded}>
          <span style={label}>Order Details</span>
          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
            <div><span style={{ color: 'var(--ink-soft)' }}>NO.</span> {docNumber}</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>DATE</span> 06/27/2026</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>P.O.</span> CUST-10239</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>TERMS</span> Net 30</div>
          </div>
        </div>
      </div>

      {/* Line items — grey-shaded column header */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
        <thead>
          <tr style={{ background: 'var(--paper-2)' }}>
            <th style={{ ...cell, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Item</th>
            <th style={{ ...cell, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Description</th>
            <th style={{ ...cell, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Qty</th>
            {showMoney && <th style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Unit</th>}
            {showMoney && <th style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>Amount</th>}
          </tr>
        </thead>
        <tbody>
          {SAMPLE_LINES.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.item}</td>
              <td style={cell}>{l.desc}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{l.qty}</td>
              {showMoney && <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{money(l.price)}</td>}
              {showMoney && <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{money(l.qty * l.price)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      {showMoney && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <div style={{ width: '260px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--ink-soft)' }}>SUBTOTAL</span><span>{money(subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--ink-soft)' }}>TAX (8.75%)</span><span>{money(tax)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', marginTop: '6px', background: 'var(--paper-2)', border: '1px solid var(--line)', fontFamily: 'var(--serif)', fontSize: '15px', fontWeight: 500 }}>
              <span>{type === 'INVOICE' ? 'Balance Due' : 'Total'}</span><span>{money(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer note + fine print */}
      {(footer || terms) && (
        <div style={{ marginTop: '26px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
          {footer ? <div style={{ fontSize: '12px', color: 'var(--ink)', marginBottom: terms ? '10px' : 0 }}>{footer}</div> : null}
          {terms ? <div style={{ fontSize: '9px', lineHeight: 1.6, color: 'var(--ink-soft)', fontFamily: 'var(--sans)' }}>{terms}</div> : null}
        </div>
      )}

      {/* Document number — print + barcode, bottom of every form (the NetSuite spine) */}
      <div style={{ marginTop: '34px', paddingTop: '16px', borderTop: '2px solid var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <span style={label}>{title} Number</span>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 600, letterSpacing: '.05em' }}>{docNumber}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <Barcode value={docNumber} height={46} moduleWidth={2} />
        </div>
      </div>
    </div>
  );
};

export default FormPreview;
