# Policy Documents — DRAFTS for underwriting + portal checkout (2026-09-09)

> ## ✅ STATUS UPDATE (2026-09-09 PM) — CE policies are LIVE on the portal
>
> Stuart answered via `0903/Merchant Services.docx`, and the Classical Elements set is now
> **published, public, no login required**: `https://portal.classicalelements.com/#/policies`
> (deep links: `#/policies/terms`, `/returns`, `/privacy`, `/security`). Source of truth for the
> live CE text is now **`portal/src/Policies.jsx`** (commit 4d0fce0) — edit there, not here.
> Links appear in the portal footer and under the sign-in card. This is the URL to hand the
> merchant-services underwriters.
>
> **Answers received (supersede the placeholders below):** THREE merchants of record —
> Classical Elements LLC · M2C Studio LLC · MC America LLC DBA Uniq'uity (= likely three MIDs;
> no Leyla). Payment: terms established prior to first order (Net 30/Net 60 for approved
> accounts), otherwise 50% deposit, balance at ship. Custom orders: no returns; manufacturing
> errors replaced free of charge ASAP; incorrectly placed orders not refundable — double-check
> the acknowledgement. Stocked items: as-new returns, 25% restocking fee, initiated via the
> portal, RA number required. Claims/returns within 10 BUSINESS days of receipt. Lead times:
> painted/stained 4 wks, plated up to 6 wks. CS: portal (fastest) or info@classicalelements.com.
>
> **Brand variants for future surfaces (from the same doc):**
> - **M2C Studio** (M2C Studio LLC): same terms as CE, plus custom lighting typically
>   12–16 weeks (see order acknowledgement); custom lighting not eligible for return.
>   CS: portal or cs@m2cstudio.com.
> - **Uniq'uity** (MC America LLC DBA Uniq'uity): custom same as CE; THROWS returnable only if
>   still packaged in plastic + as-new, 25% restocking, RA required, 10 business days.
>   CS: portal or info@uniquitystyle.com.
>
> **Still open (small):** Leyla entity/contact (absent from the doc); cards accepted beyond
> Visa/MC; stocked-goods ship-time standard (X business days); governing-law county for venue;
> analytics confirm (page currently states essential-cookies-only — true today); the catalog
> "full T&C sheet" if it says anything the above doesn't.

---

Drafted for the Visa/Mastercard website-requirements checklist (see `VENDOR_API_ONBOARDING.md`
§D). Three documents + the small print blocks the checkout screens need. Everything marked
**[STUART: …]** needs your answer. **Have a lawyer review before go-live — these are working
drafts, not legal advice.** Once approved, the app work: portal footer pages + checkout
click-to-accept (scoped in VENDOR_API_ONBOARDING.md §D3), and the same texts go into
Admin → Forms so the PDF documents and the portal always say the same thing.

**Source language (read live from Admin → Form Templates, 2026-09-09).** The SALES ORDER and
INVOICE templates carry this identical fine print (QUOTE has only the 30-day-validity header;
Work Order / Packing Slip / Factory Router carry none):

> TERMS & CONDITIONS: Please inspect all shipments immediately upon delivery. Any claims for
> damages, shortages, or discrepancies must be made in writing within 10 days of receipt. All
> custom orders are final sale and non-returnable. Standard and stocked items may be returned
> but are subject to a restocking fee; please see the full Terms and Conditions sheet in our
> catalogs for complete return details and fee schedules. We are not liable for incidental or
> consequential damages, including but not limited to contractor or installation delays. Risk
> of loss and title transfer to the buyer upon delivery.

The drafts below keep every one of those positions (10-day claims, custom = final sale,
restocking fee on stocked returns, no consequential damages, risk of loss on delivery).
**[STUART: send me the "full Terms and Conditions sheet" from the catalogs** — it has the
return details and fee schedules the form text points to, and the drafts should absorb it
rather than contradict it.]

Business identity used throughout (from the form footers): **1200 Redding Dr, High Point, NC
27260** · Classical Elements www.classicalelements.com 1 (336) 967-3313 · M2C Studio
www.m2cstudio.com 910.805.8410 · Uniquity www.uniquitystyle.com 1 (336) 290-5115 · Leyla
**[STUART: Leyla site/phone — the form footer map has no entry for it]**.

**[STUART: merchant of record?]** — the single biggest open: do all four brands transact under
ONE legal entity/MID, or several? The policies below are written for one entity ("Classical
Elements" + brand names as trade names); if brands get their own MIDs each needs its own
header block.

---

## 1. TERMS & CONDITIONS OF SALE

**Classical Elements [STUART: exact legal entity name, e.g. "Classical Elements LLC"]** — also
trading as M2C Studio, Uniquity, and Leyla ("we," "us"). These terms govern every order placed
through our trade portal, by email, by phone, or at a trade show.

**1. Trade accounts.** We sell to the trade. Orders are accepted only from approved trade
accounts registered with us. Prices, discounts, and payment terms are those of your account
agreement. All prices and payments are in **US Dollars (USD)**. We are a **United States**
company; all goods are sold from our High Point, North Carolina facility.

**2. Quotes and orders.** Written quotes are valid for **30 days** from issue; please reference
the quote number when placing your order. An order becomes binding when we confirm it in
writing (order confirmation / sales order). Custom-made goods are manufactured to the
specifications on the confirmed order; you are responsible for verifying dimensions, finishes,
and quantities on the confirmation. Changes after confirmation may not be possible once
production has begun and may carry additional charges.

**3. Payment.** Unless your account agreement states otherwise: **[STUART: deposit policy —
e.g. "custom orders require a 50% deposit at confirmation, balance due before shipment; stocked
goods are charged at shipment"? and do any accounts have Net 30? (the sample form shows
Net 30 as a terms value)]**. We accept Visa, Mastercard, **[STUART: Amex? Discover?
ACH/check?]**. Card payments are processed by our payment gateway on its PCI-DSS certified
systems; we do not store card numbers.

**4. Delivery.** Goods ship via **UPS** (or common carrier/freight for oversized items) from
our High Point, NC facility. Time standards: stocked goods typically ship within **[STUART: X
business days]**; custom finished goods typically ship in **4 weeks** (painted finishes) or
**6 weeks** (electroplated finishes) from order confirmation **[confirm — drafted from the
app's ready-date rule; publish rush 2/4 weeks?]**. Delivery dates are good-faith estimates,
not guarantees. **Risk of loss and title transfer to the buyer upon delivery** (as your
current form terms state). International/export orders: **[STUART: do you export? If yes:
"buyer is importer of record and responsible for duties, taxes, and compliance with local
import rules" + foreign shipping time standard (the card-brand checklist requires it). If no:
"we ship within the United States only."]**

**5. Inspection and claims.** Please inspect all shipments immediately upon delivery. Claims
for damages, shortages, or discrepancies must be made **in writing within 10 days of receipt**,
with photos of the packaging and goods so we can pursue the carrier claim. Defects appearing
later must be reported within **[STUART: 30?] days** of delivery.

**6. Returns and cancellations.** Per our Refund & Return Policy (below), which is part of
these terms: custom orders are final sale and non-returnable; standard and stocked items may be
returned subject to a restocking fee.

**7. Warranty.** **[STUART: your warranty — e.g. "goods are warranted free of defects in
materials and workmanship for 1 year from delivery; remedy limited to repair, replacement, or
refund at our option." Existing statement in the catalog T&C sheet?]** Finishes on custom
goods are hand-applied; reasonable variation from samples or photographs is not a defect.
EXCEPT AS STATED, GOODS ARE SOLD WITHOUT ANY OTHER WARRANTY, EXPRESS OR IMPLIED, INCLUDING
MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

**8. Limitation of liability.** We are not liable for indirect, incidental, or consequential
damages, including but not limited to contractor or installation delays or lost profits. Our
total liability for any claim will not exceed the amount paid for the goods giving rise to the
claim.

**9. Governing law.** These terms are governed by the laws of the State of **North Carolina
[confirm]**, without regard to conflicts of law; venue lies in the state and federal courts of
**[STUART: Guilford County?], North Carolina**.

**10. Contact.** 1200 Redding Dr, High Point, NC 27260 · Classical Elements 1 (336) 967-3313 ·
M2C Studio 910.805.8410 · Uniquity 1 (336) 290-5115 · Email **[STUART: customer-service
email]** · Fax **[STUART: fax # or delete]** · Customer service hours **[STUART: e.g. M–F
9–5 ET]**.

---

## 2. REFUND & RETURN POLICY

(Displayed in full before checkout; the checkout screen carries an **"I have read and accept
the Refund & Return Policy and Terms & Conditions"** checkbox — the card brands' required
"Click to Accept.")

**Custom-made goods.** Items manufactured to your specification — including custom lengths,
bends, mitres, custom finishes, and configured assemblies — are **made to order, final sale,
and non-returnable**, except when defective or not as ordered. Custom orders may be cancelled
without charge before production begins; once production has begun, cancellations **[STUART:
"forfeit the deposit" / "are charged for work completed" / not accepted?]**.

**Standard and stocked goods.** Unaltered standard/stocked items in original packaging may be
returned within **[STUART: return window — what does the catalog T&C sheet say? 30 days?]**
of delivery with a Return Merchandise Authorization (RMA) issued by our customer service.
Returns are subject to a **[STUART: %? from the catalog fee schedule] restocking fee**; return
shipping is at the customer's cost. Cut goods (e.g. cut-to-length rods) are treated as custom.

**Damaged, short, or incorrect shipments.** Inspect immediately on delivery and notify us in
writing within **10 days of receipt**. We make it right at our cost — repair, replacement, or
refund, including shipping.

**Refund method and timing.** Approved refunds are issued to the original payment method within
**[STUART: 10?] business days** of our receipt and inspection of the return (or immediately for
cancelled undelivered orders). Deposits on cancelled custom orders follow the cancellation
terms above.

**How to start a return.** Contact customer service at 1 (336) 967-3313 or **[STUART: email]**
with your order number. Returns without an RMA may be refused.

---

## 3. PRIVACY POLICY

**Who we are.** [STUART: legal entity], operating the Classical Elements, M2C Studio, Uniquity,
and Leyla brands, our trade portal at portal.classicalelements.com, and our websites
(classicalelements.com, m2cstudio.com, uniquitystyle.com **[+ Leyla domain?]**). Contact:
1200 Redding Dr, High Point, NC 27260 · 1 (336) 967-3313 · **[STUART: privacy/CS email]**.

**What we collect.** (a) Trade-account information you or your firm provide: contact name,
company, email address, phone, shipping and billing addresses, resale/tax documentation.
(b) Order and transaction history. (c) Technical/usage data when you use the portal: login
events, IP address, browser type, and the pages and features used. We use essential cookies
and browser storage to keep you signed in and remember your session; we do **[STUART: confirm:
no]** advertising or cross-site tracking cookies, and we do not use third-party analytics
**[STUART: confirm — nothing like Google Analytics on the portal or public sites?]**.

**Payment card data.** We never receive, store, or transmit your full card number. Card entry
occurs in our payment gateway's secure hosted fields and pages (PCI-DSS Level 1 certified);
we receive only a payment token, the card's last four digits and type, and the transaction
result. Saved cards ("card on file") are stored in the gateway's Customer Vault, not on our
systems, and are charged only for orders you place or authorize.

**How we use information.** To operate your trade account: quoting, order processing,
manufacturing, delivery, invoicing and payment, customer service, and required record-keeping
(tax, accounting). We do not sell or rent personal information, and we do not share it for
third-party marketing.

**Who we share it with.** Service providers who process it for us, under contract, only as
needed to serve you: our payment gateway (payment processing), United Parcel Service and other
carriers (name, address, phone for delivery), Oracle NetSuite (our business system of record),
and our hosting infrastructure — Google Cloud/Firebase (application and data hosting) and
Vercel (web hosting). We also disclose information where the law requires it.

**Security.** All connections are encrypted (HTTPS/TLS). Portal access requires an individual
login; account data access is restricted to staff who need it. Credentials and API keys are
held in managed secret storage.

**Retention.** Account and transaction records are retained while your account is active and
as required for legal, tax, and warranty purposes, then deleted or anonymized.

**Your choices.** Email [STUART: privacy email] to review, correct, or delete your
information, close your account, or ask a question about this policy. If you are in a state
with a consumer privacy law (e.g. California), you may exercise the rights that law provides
through the same contact; we do not sell personal information as those laws define it.

**Updates.** We will post any changes to this policy here with a new effective date.
Effective date: **[go-live date]**.

---

## 4. Checkout-screen small print (the remaining checklist items)

These short blocks live on the checkout/footer surfaces (portal + hosted-invoice landing +
public site if required):

- **Security statement:** "All transactions are protected with TLS (SSL) encryption. Payments
  are processed on our payment gateway's PCI-DSS Level 1 certified systems — your card number
  never touches our servers."
- **Currency:** "All prices and charges are in US Dollars (USD)."
- **Country of origin of the business:** "[Legal entity] is a United States company, located
  in High Point, North Carolina, USA."
- **Delivery:** "Orders ship via UPS from our High Point, NC facility. Stocked goods: ships
  within [X] business days. Custom goods: typically 4 weeks (painted) / 6 weeks
  (electroplated) from order confirmation." **[align with §1.4 answers]**
- **Card logos:** Visa + Mastercard ([+ Amex/Discover per §1.3 answer]) displayed at checkout.
- **Order review:** checkout's final screen shows all lines, charges, and the ship-to address
  with **Edit** and **Cancel** available before "Pay" — build requirement, noted in
  VENDOR_API_ONBOARDING.md §D3.
- **Hosting contact (checklist requires it):** "Web hosting: Vercel Inc., vercel.com ·
  Application infrastructure: Google Cloud, cloud.google.com."
- **Goods description:** one paragraph on the public-facing page: "Custom and stocked
  decorative window hardware and lighting — poles, finials, brackets, rings, traverse systems,
  and made-to-order finished assemblies — manufactured in High Point, North Carolina for the
  interior design trade." **[STUART: happy with this description?]**

---

## 5. Answers still needed from Stuart

Already answered by the live form language / codebase (no action): quote validity 30 days ·
claims window 10 days written · custom = final sale, non-returnable · restocking fee exists ·
risk of loss & title on delivery · no incidental/consequential liability · address + brand
phones/sites.

Still open:

1. **Merchant of record**: one legal entity for all four brands, or several? Exact legal
   name(s) as registered with the processor.
2. **The catalog "full Terms and Conditions sheet"** — send it; it holds the return window +
   restocking fee schedule the form text references (answers most of #8 below).
3. **Customer service email**, **hours**, **fax** (if any), and Leyla's site/phone (absent
   from the form footer map).
4. **Payment terms**: deposit % on custom orders, when balance is due, which accounts get
   Net 30? Cards beyond Visa/MC (Amex, Discover)? ACH/checks?
5. **Stocked-goods ship-time** standard (X business days); confirm 4wk/6wk custom language;
   publish rush (2/4wk)?
6. **Export**: do you sell/ship outside the US? (If yes, the checklist requires a foreign
   shipping time standard too.)
7. **Later-found defect window** (30 days?).
8. **Return window + restocking fee %** for stocked goods (likely in the catalog sheet), and
   **custom-order cancellation** after production starts: deposit forfeited / charged for work
   completed / not accepted?
9. **Refund timing** commitment (10 business days?).
10. **Warranty**: existing statement, or adopt the 1-year materials-and-workmanship draft?
11. **Governing law**: confirm North Carolina + county for venue.
12. **Analytics/tracking**: anything beyond Firebase on the portal or public sites (Google
    Analytics, Meta pixel…)? Privacy policy must disclose whatever exists.
13. Confirm the **goods description** paragraph in §4, and the public-site domain list in §3.
