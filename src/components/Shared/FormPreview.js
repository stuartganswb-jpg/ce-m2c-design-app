import React from 'react';
import { cutText } from './configQty';
import Barcode from './Barcode';

// Live, print-style preview of a branded document (Sales Order / Packing List / Invoice / Quote …).
// Serif headings, mono labels, sans body, light-grey shaded header blocks, and the document number
// printed + barcoded at the bottom (the spine that ties the order to NetSuite's quote → fulfillment
// → packing → invoice chain). Pass `data` to render a REAL order; omit it for the admin sample.

const BRAND_NAMES = { m2c: 'M2C Studio', ce: 'Classical Elements', uniquity: 'Uniquity', leyla: 'Leyla' };
// Printed at the bottom of EVERY form: shared address + the brand's own site/phone (Stuart 2026-07-11).
const COMPANY_ADDRESS = '1200 Redding Dr · High Point, NC 27260';
const BRAND_CONTACT = {
  ce: { web: 'www.classicalelements.com', phone: '1 (336) 967-3313' },
  m2c: { web: 'www.m2cstudio.com', phone: '910.805.8410' },
  uniquity: { web: 'www.uniquitystyle.com', phone: '1 (336) 290-5115' },
};
const TITLES = { QUOTE: 'Quotation', SALES_ORDER: 'Sales Order', WORK_ORDER: 'Work Order', PACKING_SLIP: 'Packing List', INVOICE: 'Invoice', FACTORY_ROUTER: 'Factory Router' };

const SAMPLE_LINES = [
  { item: 'BRIMAR-FR-1IN', desc: '1" French Return Pole — 96" finished, Antique Brass', qty: 2, price: 412.0 },
  { item: 'HCUMLPB410EB', desc: 'Center Passing Bracket, Oil-Rubbed Bronze', qty: 3, price: 38.5 },
  { item: 'RING-FIPR-225', desc: 'Flat Inset Premium Ring 2.25" (set of 7)', qty: 4, price: 64.0 },
];
const SAMPLE_BILL = ['Upholstery Loft & Decor', '1420 Market Street', 'Denver, CO 80202'];
const SAMPLE_SHIP = ['Master Suite Reno', '88 Lakeshore Dr', 'Aspen, CO 81611'];

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FormPreview = ({ type = 'SALES_ORDER', brand = 'ce', logoUrl, header, footer, terms, docNumber = 'SO10293', data }) => {
  const d = data || {};
  const title = (TITLES[type] || type.replace(/_/g, ' ')).toUpperCase();
  const company = d.company || BRAND_NAMES[brand] || (brand ? brand.toUpperCase() : 'Company');
  const isPacking = type === 'PACKING_SLIP';
  const showMoney = !isPacking && type !== 'WORK_ORDER' && type !== 'FACTORY_ROUTER';

  const billTo = (d.billTo && d.billTo.length) ? d.billTo : SAMPLE_BILL;
  const shipTo = (d.shipTo && d.shipTo.length) ? d.shipTo : SAMPLE_SHIP;
  const lines = (d.lines && d.lines.length) ? d.lines : SAMPLE_LINES;
  const date = d.date || '06/27/2026';
  const po = d.po || 'CUST-10239';
  const termsLabel = d.termsLabel || 'Net 30';

  const lineAmount = (l) => (l.amount != null ? Number(l.amount) || 0 : (Number(l.qty) || 0) * (Number(l.price) || 0));
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const tax = (d.tax != null) ? d.tax : (showMoney ? subtotal * 0.0875 : 0);
  const total = (d.total != null) ? d.total : subtotal + tax;

  const label = { fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' };
  const cell = { padding: '9px 12px', fontFamily: 'var(--sans)', fontSize: '12px', color: 'var(--ink)' };
  const th = { ...cell, fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' };
  const shaded = { background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: '2px', padding: '12px 14px' };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)', width: '100%', maxWidth: '820px', margin: '0 auto', padding: '44px 48px', fontFamily: 'var(--sans)', color: 'var(--ink)' }}>

      {/* Masthead */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid var(--ink)', paddingBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {logoUrl
            ? <img src={logoUrl} alt={company} style={{ height: '52px', maxWidth: '220px', objectFit: 'contain' }} />
            : <div style={{ fontFamily: 'var(--serif)', fontSize: '1.7rem', fontWeight: 500, letterSpacing: '.02em' }}>{company}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, lineHeight: 1, color: 'var(--ink)' }}>{title}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '6px' }}>NO. {docNumber}</div>
        </div>
      </div>

      {header ? <div style={{ fontFamily: 'var(--sans)', fontSize: '12px', fontStyle: 'italic', color: 'var(--ink-soft)', margin: '16px 0 0' }}>{header}</div> : null}

      {/* Shaded header metadata blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', margin: '22px 0' }}>
        <div style={shaded}>
          <span style={label}>Bill To</span>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{billTo.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
        <div style={shaded}>
          <span style={label}>Ship To</span>
          <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{shipTo.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
        <div style={shaded}>
          <span style={label}>Order Details</span>
          <div style={{ fontSize: '11px', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
            <div><span style={{ color: 'var(--ink-soft)' }}>NO.</span> {docNumber}</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>DATE</span> {date}</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>P.O.</span> {po}</div>
            <div><span style={{ color: 'var(--ink-soft)' }}>TERMS</span> {termsLabel}</div>
          </div>
        </div>
      </div>

      {/* Line items — grey-shaded column header */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
        <thead>
          <tr style={{ background: 'var(--paper-2)' }}>
            <th style={{ ...th, textAlign: 'left' }}>Item</th>
            <th style={{ ...th, textAlign: 'left' }}>Description</th>
            <th style={{ ...th, textAlign: 'center' }}>Qty</th>
            {showMoney && <th style={{ ...th, textAlign: 'right' }}>Unit</th>}
            {showMoney && <th style={{ ...th, textAlign: 'right' }}>Amount</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ ...cell, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.item}</td>
              <td style={cell}>
                {l.desc}
                {/* The cut, not just the footage. A pole is quantified in FEET (qty 8 = eight feet
                    of stock); the number a reader needs is the 94.5" it is cut to. */}
                {cutText(l.cut) && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '2px' }}>{cutText(l.cut)}</div>}
              </td>
              <td style={{ ...cell, textAlign: 'center' }}>{l.qty === '' || l.qty == null ? '' : l.qty}</td>
              {showMoney && <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.price == null ? '' : money(l.price)}</td>}
              {showMoney && <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: l.bold ? 600 : 400 }}>{money(lineAmount(l))}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      {showMoney && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <div style={{ width: '260px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--ink-soft)' }}>SUBTOTAL</span><span>{money(subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', fontFamily: 'var(--mono)' }}><span style={{ color: 'var(--ink-soft)' }}>TAX</span><span>{money(tax)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', marginTop: '6px', background: 'var(--paper-2)', border: '1px solid var(--line)', fontFamily: 'var(--serif)', fontSize: '15px', fontWeight: 500 }}>
              <span>{type === 'INVOICE' ? 'Balance Due' : 'Total'}</span><span>{money(total)}</span>
            </div>
          </div>
        </div>
      )}

      {(footer || terms) && (
        <div style={{ marginTop: '26px', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
          {footer ? <div style={{ fontSize: '12px', color: 'var(--ink)', marginBottom: terms ? '10px' : 0 }}>{footer}</div> : null}
          {terms ? <div style={{ fontSize: '9px', lineHeight: 1.6, color: 'var(--ink-soft)', fontFamily: 'var(--sans)' }}>{terms}</div> : null}
        </div>
      )}

      {/* Client approval signatures on quotes */}
      {type === 'QUOTE' && (
        <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'space-between', gap: '40px' }}>
          <div style={{ flex: 1, borderTop: '1px solid var(--line)', paddingTop: '8px', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Client Approval Signature</div>
          <div style={{ width: '180px', borderTop: '1px solid var(--line)', paddingTop: '8px', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Date</div>
        </div>
      )}

      {/* Document number — print + barcode at the bottom of every form (the NetSuite spine) */}
      <div style={{ marginTop: '34px', paddingTop: '16px', borderTop: '2px solid var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <span style={label}>{title} Number</span>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 600, letterSpacing: '.05em' }}>{docNumber}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <Barcode value={docNumber} height={46} moduleWidth={2} />
        </div>
      </div>

      {/* Company footer — shared address + this brand's site/phone, on every form */}
      <div style={{ marginTop: '12px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '8.5px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
        {company} · {COMPANY_ADDRESS}
        {BRAND_CONTACT[brand]?.web ? ` · ${BRAND_CONTACT[brand].web}` : ''}
        {BRAND_CONTACT[brand]?.phone ? ` · ${BRAND_CONTACT[brand].phone}` : ''}
      </div>
    </div>
  );
};

export default FormPreview;
