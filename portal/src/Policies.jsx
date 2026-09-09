import React, { useEffect } from 'react';

// Terms & Policies — the public policy page (reachable WITHOUT login at #/policies so the
// merchant-services underwriters and any cardholder can read it; the card brands' website
// checklist requires these documents to be viewable). Content approved by Stuart 2026-09-09
// (0903/Merchant Services.docx + the Admin → Forms fine print). Static by design: no auth, no
// Firestore, no callables — nothing here can leak or break the BFF.
// Sources of record: POLICY_DRAFTS.md + VENDOR_API_ONBOARDING.md in the repo root.

const EFFECTIVE = 'September 9, 2026';
const ADDRESS = '1200 Redding Dr, High Point, NC 27260, USA';
const PHONE = '1 (336) 967-3313';
const EMAIL = 'info@classicalelements.com';

const SECTIONS = [
  { id: 'terms', label: 'Terms & Conditions' },
  { id: 'returns', label: 'Returns & Refunds' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Payments & Security' },
];

const sec = { marginTop: 42, paddingTop: 26, borderTop: '1px solid var(--line)' };
const h3 = { margin: '18px 0 6px', fontSize: 15, color: 'var(--ink)' };
const p = { margin: '6px 0', fontSize: 14, lineHeight: 1.65, color: 'var(--ink-soft)' };

const Policies = () => {
  // #/policies/<section> deep-links straight to a document (footer + sign-in links use these).
  useEffect(() => {
    const target = (window.location.hash.split('/')[2] || '').replace(/[^a-z]/g, '');
    if (!target) { window.scrollTo(0, 0); return; }
    const el = document.getElementById(`policy-${target}`);
    if (el) el.scrollIntoView({ block: 'start' });
  });

  return (
    <div className="shell" style={{ maxWidth: 820 }}>
      <div style={{ padding: '28px 0 18px', borderBottom: '1px solid var(--line)' }}>
        <span className="eyebrow">Classical Elements</span>
        <h1 style={{ margin: '6px 0 4px' }}>Terms &amp; Policies</h1>
        <p style={{ ...p, margin: 0 }}>
          Classical Elements LLC · {ADDRESS} · Effective {EFFECTIVE}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <a className="btn-ghost" href="#/" style={{ textDecoration: 'none', border: '1px solid var(--line)', padding: '6px 12px' }}>← Portal</a>
          {SECTIONS.map((s) => (
            <a key={s.id} className="btn-ghost" href={`#/policies/${s.id}`} style={{ textDecoration: 'none', border: '1px solid var(--line)', padding: '6px 12px' }}>{s.label}</a>
          ))}
        </div>
      </div>

      {/* ---------------- TERMS & CONDITIONS OF SALE ---------------- */}
      <section id="policy-terms" style={sec}>
        <h2 className="sec">Terms &amp; Conditions of Sale</h2>
        <p style={p}>
          These terms govern every order placed with <strong>Classical Elements LLC</strong> ("we," "us") —
          through this client portal, by email, by phone, or at a trade show. Classical Elements LLC is the
          merchant of record for purchases made under the Classical Elements brand.
        </p>

        <h3 style={h3}>1. Trade accounts</h3>
        <p style={p}>
          We sell to the trade. Orders are accepted only from approved trade accounts registered with us.
          Prices, discounts, and payment terms are those of your account agreement. All prices and payments
          are in <strong>US Dollars (USD)</strong>. We are a United States company; goods are sold from our
          High Point, North Carolina facility.
        </p>

        <h3 style={h3}>2. Quotes, orders, and acknowledgements</h3>
        <p style={p}>
          Written quotes are valid for 30 days from issue — please reference the quote number when placing
          your order. An order becomes binding when we confirm it with an order acknowledgement. Our custom
          goods are made to order to the specifications on that acknowledgement, so please double-check it —
          dimensions, finishes, and quantities — as orders placed incorrectly are not refundable. Changes
          after confirmation may not be possible once production has begun and may carry additional charges.
        </p>

        <h3 style={h3}>3. Payment</h3>
        <p style={p}>
          Payment terms are established with your account prior to your first order (approved accounts may
          carry Net 30 or Net 60 terms). Where terms are not established: a 50% deposit is due at order
          confirmation, with the balance due at shipment. Card payments are processed by our payment gateway
          on its PCI-DSS certified systems; we do not store card numbers.
        </p>

        <h3 style={h3}>4. Delivery</h3>
        <p style={p}>
          Goods ship via UPS (or common carrier for oversized items) from High Point, NC. Painted and stained
          custom orders typically ship in 4 weeks; plated items take up to 6 weeks to complete. Your order
          acknowledgement carries the delivery specifics for your order, including international shipments.
          Delivery dates are good-faith estimates, not guarantees. Risk of loss and title transfer to the
          buyer upon delivery.
        </p>

        <h3 style={h3}>5. Inspection and claims</h3>
        <p style={p}>
          Please inspect all shipments immediately upon delivery. Any claims for damages, shortages, or
          discrepancies must be made in writing within 10 business days of receipt — photos of the packaging
          and goods help us pursue the carrier claim quickly.
        </p>

        <h3 style={h3}>6. Returns</h3>
        <p style={p}>Per our Returns &amp; Refunds policy below, which is part of these terms.</p>

        <h3 style={h3}>7. Our workmanship</h3>
        <p style={p}>
          If we make a manufacturing error, we will replace the item free of charge as soon as possible.
          Finishes on custom goods are hand-applied; reasonable variation from samples or photographs is not
          a defect. EXCEPT AS STATED, GOODS ARE SOLD WITHOUT ANY OTHER WARRANTY, EXPRESS OR IMPLIED,
          INCLUDING MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.
        </p>

        <h3 style={h3}>8. Limitation of liability</h3>
        <p style={p}>
          We are not liable for incidental or consequential damages, including but not limited to contractor
          or installation delays. Our total liability for any claim will not exceed the amount paid for the
          goods giving rise to the claim.
        </p>

        <h3 style={h3}>9. Governing law</h3>
        <p style={p}>
          These terms are governed by the laws of the State of North Carolina, without regard to conflicts of
          law.
        </p>

        <h3 style={h3}>10. Contact</h3>
        <p style={p}>
          Customer service can be reached through this portal (fastest) or at {EMAIL} · {PHONE} · {ADDRESS}.
        </p>
      </section>

      {/* ---------------- RETURNS & REFUNDS ---------------- */}
      <section id="policy-returns" style={sec}>
        <h2 className="sec">Returns &amp; Refunds</h2>

        <h3 style={h3}>Custom orders</h3>
        <p style={p}>
          Custom orders are made to order and are <strong>not eligible for return</strong>. If we make a
          manufacturing error we will replace the item free of charge as soon as possible — but orders placed
          incorrectly are not refundable, so please double-check your order acknowledgement. Cut goods (for
          example cut-to-length rods) are treated as custom.
        </p>

        <h3 style={h3}>Stocked items</h3>
        <p style={p}>
          Stocked items returned in as-new condition and original packaging are accepted subject to a
          <strong> 25% restocking fee</strong>; return shipping is at the customer's cost.
        </p>

        <h3 style={h3}>How to start a return or claim</h3>
        <p style={p}>
          Please initiate any return through this client portal — no returns are accepted without a Return
          Authorization (RA) number. Any claim or return must be initiated within <strong>10 business days of
          receipt</strong>.
        </p>

        <h3 style={h3}>Refunds</h3>
        <p style={p}>
          Approved refunds are issued to the original payment method within 10 business days of our receipt
          and inspection of the return (or of approval, for cancelled undelivered orders).
        </p>
      </section>

      {/* ---------------- PRIVACY ---------------- */}
      <section id="policy-privacy" style={sec}>
        <h2 className="sec">Privacy Policy</h2>
        <p style={p}>
          <strong>Who we are.</strong> Classical Elements LLC, operating this trade portal
          (portal.classicalelements.com) and www.classicalelements.com. Contact: {ADDRESS} · {PHONE} ·
          {' '}{EMAIL}.
        </p>
        <p style={p}>
          <strong>What we collect.</strong> Trade-account information you or your firm provide (contact name,
          company, email, phone, shipping and billing addresses, resale/tax documentation); your order and
          transaction history; and technical data when you use the portal (login events, IP address, browser
          type, pages used). The portal uses essential cookies and browser storage only — to keep you signed
          in and remember your session. We do not use advertising or cross-site tracking cookies.
        </p>
        <p style={p}>
          <strong>Payment card data.</strong> We never receive, store, or transmit your full card number.
          Card entry occurs in our payment gateway's secure hosted fields and pages (PCI-DSS Level 1
          certified); we receive only a payment token, the card's last four digits and type, and the
          transaction result. Saved cards are stored in the gateway's Customer Vault, not on our systems, and
          are charged only for orders you place or authorize.
        </p>
        <p style={p}>
          <strong>How we use information.</strong> To operate your trade account: quoting, order processing,
          manufacturing, delivery, invoicing and payment, customer service, and required record-keeping. We
          do not sell or rent personal information, and we do not share it for third-party marketing.
        </p>
        <p style={p}>
          <strong>Who we share it with.</strong> Service providers who process it for us, only as needed to
          serve you: our payment gateway (payment processing), United Parcel Service and other carriers
          (delivery), Oracle NetSuite (our business system of record), and our hosting infrastructure —
          Google Cloud/Firebase (application and data hosting) and Vercel (web hosting). We also disclose
          information where the law requires it.
        </p>
        <p style={p}>
          <strong>Security &amp; retention.</strong> All connections are encrypted (HTTPS/TLS); portal access
          requires an individual login, and account data is restricted to staff who need it. Account and
          transaction records are retained while your account is active and as required for legal, tax, and
          warranty purposes.
        </p>
        <p style={p}>
          <strong>Your choices.</strong> Email {EMAIL} to review, correct, or delete your information, close
          your account, or ask a question about this policy. We do not sell personal information as state
          privacy laws define it. Changes to this policy are posted here with a new effective date.
        </p>
      </section>

      {/* ---------------- PAYMENTS & SECURITY ---------------- */}
      <section id="policy-security" style={sec}>
        <h2 className="sec">Payments &amp; Security</h2>
        <p style={p}>
          All transactions are protected with TLS (SSL) encryption. Payments are processed on our payment
          gateway's PCI-DSS Level 1 certified systems — your card number never touches our servers.
        </p>
        <p style={p}>
          All prices and charges are in US Dollars (USD). Classical Elements LLC is a United States company
          located in High Point, North Carolina, USA. Orders ship via UPS from our High Point facility (see
          Delivery, above). Before any payment is completed you will be shown your full order — items,
          charges, and ship-to address — with the option to edit or cancel.
        </p>
        <p style={p}>
          Web hosting: Vercel Inc. (vercel.com). Application infrastructure: Google Cloud
          (cloud.google.com).
        </p>
      </section>

      <footer className="portal" style={{ marginTop: 48 }}>
        <span>Classical Elements LLC · {ADDRESS} · {PHONE}</span>
        <a href="https://www.classicalelements.com">www.classicalelements.com</a>
      </footer>
    </div>
  );
};

export default Policies;
