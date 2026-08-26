// USER GUIDE (Stuart 2026-08-26: "post it on the app as tab after app improvements") — the
// team-facing manual. Content is maintained HERE, in plain JSX, one section per subject; the
// section chips at the top switch between them. Keep the writing at team level: what each screen
// does, when to use which, and the edges to know — no internals, no field names.
import React, { useState } from 'react';

const S = {
    wrap: { maxWidth: '1080px', margin: '0 auto', padding: '30px 28px 120px' },
    h1: { fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500, margin: '0 0 8px', color: 'var(--ink)' },
    stand: { fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-soft)', maxWidth: '68ch', margin: '0 0 24px', lineHeight: 1.6 },
    chips: { display: 'flex', gap: '10px', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: '18px', marginBottom: '28px' },
    chip: (on) => ({ padding: '9px 18px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', cursor: 'pointer', border: '1px solid', borderColor: on ? 'var(--brass)' : 'var(--line)', background: on ? 'var(--brass)' : '#fff', color: on ? '#fff' : 'var(--ink)' }),
    h2: { fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, margin: '36px 0 14px', color: 'var(--ink)' },
    tabno: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', fontWeight: 400 },
    p: { fontSize: '0.95rem', lineHeight: 1.65, color: 'var(--ink)', maxWidth: '76ch', margin: '0 0 12px' },
    card: { border: '1px solid var(--line)', background: '#fff', marginBottom: '20px' },
    cardHd: { padding: '13px 20px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' },
    cardTitle: { margin: 0, fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500 },
    cardTag: { fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--brass)' },
    cardBody: { padding: '6px 20px 14px' },
    path: { display: 'grid', gridTemplateColumns: 'minmax(120px, 150px) 1fr', gap: '4px 18px', padding: '11px 0', borderBottom: '1px solid rgba(28,26,22,.06)', fontSize: '0.92rem', lineHeight: 1.55 },
    pathName: { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--brass)', paddingTop: '3px', fontWeight: 600 },
    goes: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '4px', letterSpacing: '.02em' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
    th: { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-soft)', background: 'var(--paper-2)' },
    td: { padding: '10px 12px', borderBottom: '1px solid rgba(28,26,22,.08)', verticalAlign: 'top', lineHeight: 1.5 },
    rule: { border: '1px solid var(--brass)', background: '#fff', padding: '16px 20px', margin: '20px 0', fontFamily: 'var(--serif)', fontSize: '1.02rem', lineHeight: 1.55, maxWidth: '80ch' },
    note: { borderLeft: '2px solid var(--line)', background: 'var(--paper-2)', padding: '12px 18px', margin: '16px 0', fontSize: '0.9rem', lineHeight: 1.6, maxWidth: '80ch' },
    edge: { margin: '0 0 12px', paddingLeft: '22px', fontSize: '0.93rem', lineHeight: 1.6, maxWidth: '80ch' },
};

const Path = ({ name, goes, children }) => (
    <div style={S.path}>
        <b style={S.pathName}>{name}</b>
        <div>
            <div>{children}</div>
            {goes && <div style={S.goes}>→ {goes}</div>}
        </div>
    </div>
);

const Screen = ({ title, tag, children }) => (
    <div style={S.card}>
        <div style={S.cardHd}><h3 style={S.cardTitle}>{title}</h3><span style={S.cardTag}>{tag}</span></div>
        <div style={S.cardBody}>{children}</div>
    </div>
);

const WorkOrdersGuide = () => (
    <div>
        <h2 style={S.h2}>Which screen, in one minute</h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>You want to…</th><th style={S.th}>Go to</th><th style={S.th}>Why there</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Replenish stocked finished items the way sales history says to</td><td style={S.td}><b>Stocked Sales Snapshot</b> (in 12.5)</td><td style={S.td}>Reads NetSuite sales + live stock, recommends quantities, raises POs and WOs in one pass — pole cuts and urgent flags handled.</td></tr>
                    <tr><td style={S.td}>Build raw mill cores (H1 bases) for the shop</td><td style={S.td}><b>12.5 Stock View → RAW view</b></td><td style={S.td}>Cores route to the SHOP. The RAW generator routes them there directly; the FIN snapshot parks a raw code route-open in RTG for you to send.</td></tr>
                    <tr><td style={S.td}>Work an H1 family at all three tiers at once (raw · /P · plated)</td><td style={S.td}><b>12.5 Stock View → TIER view</b></td><td style={S.td}>One pass: raw → shop WO or vendor PO, /P → a Convert to-do, /EP → a Plating to-do, painted → finishing WO.</td></tr>
                    <tr><td style={S.td}>Run ONE item now, from its card, with a live component check</td><td style={S.td}><b>4. Master Library</b></td><td style={S.td}>Checks live NetSuite component stock before creating and offers make-up orders interactively; the batch screens now run the same pre-check automatically.</td></tr>
                    <tr><td style={S.td}>Repaint pieces with no assembly behind them</td><td style={S.td}><b>4. Master Library → Just For Paint</b></td><td style={S.td}>JFP is its own animal — see the panel below.</td></tr>
                    <tr><td style={S.td}>Send a custom sales order to the floors</td><td style={S.td}><b>13. RTG Dispatch</b></td><td style={S.td}>Not these screens: quotes become sales orders and RTG splits them to shop / finishing / packaging — automatically when ⚡ Auto-Release is on.</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>1 · Master Library <span style={S.tabno}>(tab 4 — one item at a time, from its card)</span></h2>
        <Screen title="Generate Production Work Order" tag="five distinct paths">
            <Path name="Raw build" goes="RTG (parked) · no stock check">No finish selected → <em>Push to RTG Dispatch</em>. One work order, parked at Approved; released to a floor from RTG (or by Auto-Release), where the NetSuite work order is queued.</Path>
            <Path name="Outsourced finish" goes="WMS Plating (+ shop WO when the core is short) · live check, blocking">An item ending in a plated finish (…/EP1) becomes a <em>plating demand</em> on the WMS plating tab. This path runs a <b>blocking</b> live stock check on the mill cores first: in stock → plating demand; short → a shop WO to mill the core is parked <em>first</em>. If NetSuite can't be reached, nothing is created at all.</Path>
            <Path name="In-house finishing run" goes="Finishing floor (direct) + NetSuite WO · live check, shorts prompt the cascade">Pick an In-House Finish → <em>Create &amp; Push to Finishing Floor</em>. Explodes the BOM, runs a <b>live component check</b>, shows the pull lines, and releases <b>straight to the Setup Queue</b> — RTG keeps the ledger copy, and a real NetSuite work order is queued so components commit.</Path>
            <Path name="Make-up cascade" goes="WMS Convert + RTG-parked shop WOs">When that check finds shorts, the cascade offers the prerequisite orders: a /P core short becomes a <em>Convert to-do</em>, and if the raw behind it is also short, a shop WO for the difference. You confirm each quantity — batch it up rather than ordering the exact shortfall.</Path>
            <Path name="Just For Paint" goes="Finishing floor (direct) · existence check only">Only on the JFP template card — see below.</Path>
        </Screen>
        <div style={S.rule}><b>Just For Paint</b> is a paint run with <em>no assembly and no NetSuite work order</em>. Type the NetSuite item #, optionally a <em>Pull Pieces From</em> item (repainting existing stock), pick the finish and quantity. The floor picks the pull item (a minus adjustment), paints, and packing closes it with a plus adjustment of the painted item into the scanned bin — adjustments, not an assembly build, because there is nothing to build. It verifies the items <em>exist</em> in NetSuite but never checks <em>quantity</em> — confirm the pieces are really on the shelf first.</div>

        <h2 style={S.h2}>2 · Stock View <span style={S.tabno}>(tab 12.5 — batch builders over the whole catalog)</span></h2>
        <Screen title="The builders" tag="type quantities, press once">
            <Path name="WO builder (grid)" goes="RTG (parked) · no stock check — suggestions are advisory">Type quantities on finished items → <em>Push Work Order to RTG Dispatch</em>. Routes by the item code: a finish suffix (…/BS) locks it to the finishing floor with the recipe stamped; a raw or /P code can still go to the shop. Assemblies get their BOM exploded, so the floor pulls the components the BOM names.</Path>
            <Path name="PO builder" goes="RTG POs + WMS Plating (+ auto shop WO on shortfall)">The same grid, buying instead of making. Vendor lines group into one PO per vendor (parked in RTG, pushed to NetSuite from there). Lines wearing a plated finish become <em>plating demands</em> — and if the raw base behind one is short, a milling WO for the shortfall is raised <b>automatically</b>. That check reads the last "Pull NetSuite Stock" — pull first, or it assumes zero.</Path>
            <Path name="RAW view" goes="RTG (parked, SHOP route) or vendor PO"><em>Generate Core Orders</em> — raw mill cores routed make-vs-buy: in-house → shop WOs; vendored → the vendor PO modal. Items flagged <b>both</b> open the modal defaulted to <em>make in-house</em>.</Path>
            <Path name="TIER view" goes="shop / Convert / Plating / finishing, one press"><em>Generate Tier Orders</em> — the H1 three-tier pass. Raw base → shop WO or PO; <b>/P → a Convert to-do</b> (never a work order — the WMS convert IS the stock movement); <b>/EP → a Plating to-do</b>; painted variants → finishing WOs. If converts + plating would eat more raw base than exists, the confirm warns — it never auto-orders the base, because the base row is right there.</Path>
        </Screen>

        <h2 style={S.h2}>3 · Stocked Sales Snapshot <span style={S.tabno}>(inside 12.5 — the sales-driven replenisher)</span></h2>
        <Screen title="Generate Orders" tag="recommendation → one pass">
            <Path name="The recommendation">Reads 12 months of NetSuite sales per item plus live available + on-order, and recommends an order quantity. Red <b>URGENT</b> flags come from the warehouse — a picker hit a shortage on a real job.</Path>
            <Path name="Bought items" goes="RTG POs">One purchase order per vendor, parked in RTG; RTG pushes it to NetSuite. A line with no matching NetSuite vendor is refused, never guessed.</Path>
            <Path name="Made items" goes="RTG (parked, verbatim release) + NetSuite WO at release">One WO per row, parked in RTG carrying a <b>complete pre-built finishing job</b> — recipe, sizes, pole counts, BOM pull lines, notes. Release sends exactly that document to the Setup Queue and queues the real NetSuite work order. What you see parked is what the floor gets. Rows route by what the item is: a <b>/P</b> becomes a Convert to-do instead, and a <b>raw</b> code parks route-open for RTG to send to shop or finishing.</Path>
            <Path name="In-house w/ vendor">A chooser per item: PO or WO. Heads-up: this modal defaults to <em>PO</em>, while RAW/TIER default the same both-sourced items to <em>make</em>.</Path>
            <Path name="Pole cuts" goes="cut order gate → then release">A 4 ft or 6 ft pole order automatically raises a <em>cut order</em> from 8 ft stock first, and the WO is <b>gated</b> until the warehouse completes the cut (WMS → Rod Cuts → Cuts for Finishing). The cut posts the NetSuite movement and prints the setup label.</Path>
            <Path name="Component pre-check" goes="convert gate → then release (new 26 Aug)">Before a finished-goods WO is written, its component pull lines are checked against <b>live NetSuite stock</b>. A short <b>/P core</b> raises a Convert to-do and the WO parks <b>⇄ AWAITING CONVERT</b> in RTG — Auto-Release skips it, and the gate clears itself the moment the WMS posts the convert. If the raw behind the /P is short too, a component <b>shop WO</b> (milling) is parked alongside; the convert can't post until the shop makes the raw, so the chain orders itself. Same check on the WO grid and the scrap re-make.</Path>
            <Path name="⇄ Convert suggestions">The ⇄ button attaches a donor suggestion ("convert 5 × …/EP2 back to raw") that rides the WO to the floor. It suggests — the operator runs the conversion.</Path>
        </Screen>

        <h2 style={S.h2}>The two product models — why the pull lines differ</h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}></th><th style={S.th}>Model A — stocked finished assembly</th><th style={S.th}>Model B — custom division</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}><b>Who</b></td><td style={S.td}>Brimar, H2 — assemblies with a real BOM</td><td style={S.td}>H1 customs — a mill core and its /P, nothing else stocked</td></tr>
                    <tr><td style={S.td}><b>Pull rule</b></td><td style={S.td}>The BOM is taken <b>literally</b> — the components it names are what the floor pulls, matching NetSuite's assembly build exactly</td><td style={S.td}>The routing IS the substitution: an in-house finish pulls the <b>/P phosphated core from stock</b>; an outsourced finish sends the <b>raw mill core</b> to the plater</td></tr>
                    <tr><td style={S.td}><b>Never</b></td><td style={S.td}>substitute /P into a literal BOM</td><td style={S.td}>invent components that aren't there</td></tr>
                </tbody>
            </table>
        </div>
        <div style={S.note}><b>The /P rule, plainly:</b> /P phosphate cores are <em>stocked</em>. A custom H1 order with an in-house finish always <b>pulls /P from the shelf</b> — it never triggers phosphating for that order. Phosphating (raw → /P) is its own bulk operation, run from the WMS Convert tab against Convert to-dos, on the replenishment cycle — never per special order. Custom stays custom.</div>

        <h2 style={S.h2}>Stock checks &amp; prerequisite orders — the honest matrix</h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>Path</th><th style={S.th}>Checks stock first?</th><th style={S.th}>When short</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Library · finishing run</td><td style={S.td}>live NetSuite components</td><td style={S.td}>prompts; make-up cascade raises converts + shop WOs</td></tr>
                    <tr><td style={S.td}>Library · outsourced/plating</td><td style={S.td}>live, <b>blocking</b></td><td style={S.td}>mills the core first, automatically parked</td></tr>
                    <tr><td style={S.td}>Library · raw push / JFP</td><td style={S.td}>no (JFP: existence only)</td><td style={S.td}>—</td></tr>
                    <tr><td style={S.td}>Stock View · WO grid</td><td style={S.td}>live component pre-check (26 Aug)</td><td style={S.td}>/P short → Convert to-do + the WO <b>gates</b>; raw behind it short → component shop WO</td></tr>
                    <tr><td style={S.td}>Stock View · PO/plating</td><td style={S.td}>session-cached stock</td><td style={S.td}>auto-raises the milling WO for the shortfall</td></tr>
                    <tr><td style={S.td}>Stock View · RAW / TIER</td><td style={S.td}>advisory + tier warning; TIER's finished rows get the pre-check</td><td style={S.td}>warns in the confirm; you order the base yourself</td></tr>
                    <tr><td style={S.td}>Sales Snapshot</td><td style={S.td}>live sales + availability, plus the component pre-check (26 Aug)</td><td style={S.td}>/P short → Convert to-do + the WO <b>gates</b>; raw short → component shop WO</td></tr>
                    <tr><td style={S.td}>Setup Queue · scrap re-make</td><td style={S.td}>live component pre-check (26 Aug)</td><td style={S.td}>same: convert + gate, or component shop WO</td></tr>
                    <tr><td style={S.td}>Order Entry (7) · to-be-finished lines</td><td style={S.td}>live component pre-check (27 Aug)</td><td style={S.td}>same cascade; the WO also waits for NetSuite to accept the SO</td></tr>
                </tbody>
            </table>
        </div>
        <div style={S.note}><b>The rule that holds it together:</b> prerequisite work is real work. A pole that needs cutting gates its work order until the cut is done. A short mill core gets its own parked WO before the plating goes out. When the system offers you a make-up order, take it — releasing through a short just moves the surprise to the pick station.</div>

        <h2 style={S.h2}>⚡ Auto-Release <span style={S.tabno}>(RTG, new 26 Aug)</span></h2>
        <p style={S.p}>When Auto-Release is ON (the ⚡ button on RTG Dispatch), newly created orders push themselves to the floors <b>one at a time</b>, in arrival order — sales orders auto-split, stock WOs follow their stated route, everything logged on the board and the Daily Job Log. Orders that need a human still wait: anything gated on a rod cut, stopped, ambiguous about its route, or created before the switch was flipped stays parked for a manual push. RTG stays the record and the control — turn the ⚡ off any time to go back to manual.</p>

        <h2 style={S.h2}>Edges to know <span style={S.tabno}>(true today — being scheduled for fixes)</span></h2>
        <ul style={{ paddingLeft: '4px', listStyle: 'none' }}>
            <li style={S.edge}>• <b>The FIN snapshot now routes by what the item IS</b> (fixed 26 Aug): a /P ordered there becomes a <em>Convert to-do</em> (same as the TIER view), and a raw/no-suffix code parks in RTG with its route <em>open</em> — RTG shows both Push buttons and Auto-Release leaves it for a human. Finished codes behave exactly as before. RAW/TIER remain the purpose-built views for cores and H1 families.</li>
            <li style={S.edge}>• <b>Both-sourced items default differently by screen</b> — FIN snapshot modal defaults to PO, RAW/TIER default to make. Read the modal, don't just click through.</li>
            <li style={S.edge}>• <b>Poles released from the Master Library run as small parts.</b> The Library's direct-to-floor path doesn't carry pole/size scheduler keys yet — release pole runs from Stock View or the Snapshot.</li>
            <li style={S.edge}>• <b>Pull NetSuite Stock before using the PO builder's plating split</b> — its short-check reads the session cache and assumes zero without a pull.</li>
            <li style={S.edge}>• <b>On-Order counts NetSuite only.</b> A PO or WO generated but not yet pushed from RTG is invisible to the snapshot — release promptly (or let Auto-Release do it) and don't re-generate the same shortfall twice in one sitting.</li>
            <li style={S.edge}>• <b>JFP never checks quantity.</b> Confirm the pull pieces are physically there before raising the run.</li>
        </ul>

        <p style={{ ...S.p, fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', paddingTop: '20px', marginTop: '30px' }}>Wherever an order is raised, it lands in the same place: parked or recorded on RTG Dispatch, identity stamped, released once, tracked by the same status every screen reads. If two screens ever give you two different answers about the same item, that is a bug — report it in App Imp., don't work around it.</p>
    </div>
);

// Orders & Customers: CPQ (8) · Order Entry (7) · Customer Collections (4.6).
const OrdersCustomersGuide = () => (
    <div>
        <h2 style={S.h2}>The map in one minute</h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>Question</th><th style={S.th}>Screen</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Configure and price a <b>custom</b> product, save it as a quote or sales order</td><td style={S.td}><b>8. CPQ Configurator</b></td></tr>
                    <tr><td style={S.td}>Enter a <b>stocked</b> order or quote — flat lines, kits, fees, no BOM build</td><td style={S.td}><b>7. Quick Ship / Order Entry</b></td></tr>
                    <tr><td style={S.td}>What a customer <b>calls</b> our parts, what they <b>pay</b>, their kits, fees and checkout items</td><td style={S.td}><b>4.6 Customer Collections</b></td></tr>
                    <tr><td style={S.td}>Who the customer <b>is</b> — contacts, terms, discount code, portal access &amp; collections</td><td style={S.td}><b>10. External Co-Op (CRM)</b></td></tr>
                    <tr><td style={S.td}>Standard checkout items <b>every</b> customer sees on a flow</td><td style={S.td}><b>11. System Admin</b> (the flow's Checkout Items list)</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>8 · CPQ Configurator <span style={S.tabno}>(custom orders)</span></h2>
        <Screen title="The flow, start to saved" tag="configure · price · quote">
            <Path name="1 · Customer bar first">Pick the <b>Active Customer</b> before configuring — it drives every price. Set the order <b>Sidemark</b> (prints on the quote, SO and packing slip) and the <b>Price Level</b> (Standard, or the Fabricut tiers for customers set up that way in 4.6 — items keep the level they were added at).</Path>
            <Path name="2 · Pick a flow">Choose the collection/flow; families that come in several rod diameters ask for the diameter first. ↺ Reset clears the flow and starts fresh.</Path>
            <Path name="3 · Walk the steps">Framing questions (rod type, single/double, drive, mount, projection) → picture cards for ends, brackets, rings — with matching backplates nested under the arm. Quantity boxes appear only where the count is a real decision, pre-filled with the recommendation. The <b>length step</b> shows billed feet (rounded up) and asks the <b>splice question</b> over the one-piece limit: default location is CENTER; note the exact spot if different — Vision draws it where the note says. "why not the other N?" explains any option that was filtered away.</Path>
            <Path name="4 · Finish">The Finish column applies one finish to the whole configuration; per-part exceptions go under the chosen item. Every priced line prints its finish.</Path>
            <Path name="5 · Notes">The <b>Note</b> box rides to the shop; the <b>Config memo</b> ("Living Room 1") prints on the quote line, router and floor card.</Path>
            <Path name="6 · Quantity — the last question">The final step asks <b>Quantity of this configuration</b>: how many complete, identical builds of the exact config. Entering 2 doubles <i>every part</i> — two poles at the same cut length, two of each bracket, two of everything — <b>never a dimension</b>. The floor cards, pick screen and router all print it as "2 × 7 = 14" style so a doubled count reads as two builds, and NetSuite bills every line × the quantity (per-foot rod bills feet × quantity; the cut length stays per-piece).</Path>
            <Path name="7 · Cart">Add to quote, then configure the next room — each line keeps its own sidemark and qty; <b>Edit</b> reopens a line, trade discounts (from the customer's CRM discount code, Standard level only, items only) show per line.</Path>
            <Path name="8 · Checkout">Verify customer → shipping (saved NetSuite address or custom drop-ship, optional shipping $ that lands on the NetSuite header) → job name, sidemark, customer PO #, internal memo (never customer-facing) → <b>Add-ons &amp; fees</b> (rush, packaging, strike-offs — each becomes its own line; percentage fees compute off the configured subtotal, so they never compound).</Path>
            <Path name="9 · Save = send" goes="CRM pipeline · RTG board · NetSuite — automatically"><b>💾 Save as Quote</b> puts it on the customer's pipeline and queues the NetSuite estimate; <b>🛒 Save as Sales Order</b> also puts it on the RTG board and queues the NetSuite SO. The real numbers write back onto the record within ~a minute. No approve-then-push relay — saving is sending.</Path>
            <Path name="10 · Documents">A print window opens with the Quotation, the Factory Router (BOM), and one Engineering Drawing page per Vision drawing. Drawings also file to the customer's CRM record.</Path>
            <Path name="Reopening">From the CRM card, <b>Reopen CPQ</b> restores the whole session — cart, customer, sidemark, PO, shipping. Re-finalizing merges into the SAME quote. If it already reached NetSuite, re-pushing creates a NEW estimate — close the old one there.</Path>
        </Screen>

        <h2 style={S.h2}>7 · Quick Ship / Order Entry <span style={S.tabno}>(stocked orders — flat lines, no BOM)</span></h2>
        <Screen title="The counter" tag="stock · to-be-finished · kits · fees">
            <Path name="Portal requests">Customer-built stock quotes from the portal land at the top — <b>Load into cart</b> fills customer, job and every line with zero re-entry, repriced at today's prices.</Path>
            <Path name="Customer & scope">Pick the customer, then <b>Collection Scope</b>: their assigned collections group first, but staff are never blocked from the rest. Scope is alias-aware — the customer's own codes pull in the real stocked items they point to.</Path>
            <Path name="Adding lines">Four quick-add rows: <b>Stocked item</b>; <b>To Be Finished</b> (raw part + finish, pre-filled with this customer's price, editable for phone orders); <b>Fee</b> (percentage fees compute off the order and move as lines change); and the customer's <b>checkout items</b> — the same 4.6 list CPQ checkout shows. Pack-sold items count in packs on the invoice and in eaches everywhere else.</Path>
            <Path name="Kits">Prebuilt kits filed by collection — pick the finish and every component swaps to its /CODE variant; missing variants are named, never half-built. <b>$ Kit Pricing</b> sets the base kit price and per-customer kit prices (the kit price distributes across the lines so the SO totals exactly it). Traverse kits resolve from the customer's pasted kit code, with motor, projection and finish handled.</Path>
            <Path name="Item missing?">Type the code in the "Item missing?" box — it replays every filter and names the one that rejected it, so you know whether it's scope, diameter, or stocking.</Path>
            <Path name="Create the record" goes="record saved HERE first · staged NetSuite sync · WMS lists it when NetSuite accepts"><b>Create Sales Order</b> or <b>Create Quote</b> — same cart, same fields. The record saves locally first; the NetSuite write posts through the staged sync in ~a minute and the real number replaces the app id. A quote now also lands on the customer's CRM pipeline. An SO enters the warehouse's Stock tab only once NetSuite accepts it.</Path>
            <Path name="To-be-finished → floor" goes="RTG-parked finishing WO per line (new 27 Aug)">A sales order's <b>To Be Finished</b> lines fire their own <b>finishing work orders</b> at save — parked in RTG under the customer's name, recipe = the chosen finish, pulling the /P of each component exactly like a CPQ custom, with the <b>component pre-check</b> (short /P → Convert to-do + gate; short raw → component shop WO). Each WO waits <b>⏳ AWAITING SO ACCEPT</b> until NetSuite takes the sales order — a rejected order never becomes work. Never order these from Stock View or the snapshot: those screens see BOM demand, not the finish. On the WMS Stock card those lines read <b>FROM FINISHING — do not pull raw</b>.</Path>
            <Path name="Sales order → invoice">The record is a <b>sales order</b> (CRM shows it under Order Entry — Sales Orders; the 📄 Order button prints the confirmation). The document becomes an <b>invoice</b> only at fulfillment — once packed/shipped, 🧾 Invoice appears and <b>Match NetSuite Invoice #</b> ties it 1:1 to the NetSuite bill before sending.</Path>
        </Screen>

        <h2 style={S.h2}>4.6 · Customer Collections <span style={S.tabno}>(their numbers, their prices, their catalog)</span></h2>
        <Screen title="One customer × one collection" tag="live in CPQ, Quick Ship & the portal on save">
            <Path name="The pickers">Pick the <b>customer</b>, their <b>Prices at</b> level (the one place the default level is set), the <b>mode</b> (Collection · Fees · Kits · Checkout Items · Plate Pricing · Arms &amp; Returns), and the <b>collection</b>. Nothing writes until <b>💾 Save</b>; every bulk action means "all rows currently shown" — search first.</Path>
            <Path name="The grid">Per item: <b>Base $</b> (OUR price — changing it changes it for everyone), <b>Their SKU</b> (what they call it — prints on quotes, spec sheets, the portal), <b>Their Net $</b> (what they pay us — blank means base price), <b>Their Sales $</b> and <b>Their Retail $</b> (their tiers). A ⤿ badge marks aliases — edit the MAIN item; the alias is display identity only.</Path>
            <Path name="⚙ P / EP editor">Per-row painted/plated/own price tiers with their pattern #s. The contract: <b>blank = no price at that tier</b> (falls back to standard); <b>"$0 · w/ arm" = explicit $0</b> (the arm carries the value). ＋ Alias creates the customer-facing item number; quotes and the portal show it, the floor and NetSuite keep the real code.</Path>
            <Path name="🛒 Checkout Items — two homes">Customer-specific items: tick <b>For [Customer]</b> here and price the same row — they appear on CPQ checkout AND Quick Ship for that customer. Standard items every customer sees: the <b>Std</b> tick here (item-wide) or the flow's own list on tab 11. Never tick anything a flow already charges (french returns, cover-plate upcharges) — that double-bills. Note: a customer-specific tick does NOT reach their portal checkout — portal needs the Std tick.</Path>
            <Path name="💲 Fees">The brand's whole fee catalogue: flat-per-unit or percentage-with-minimum, and the <b>Portal</b> tick for customer-self-serve. Don't create a duplicate fee for a customer — put their part # in Their SKU on the existing row; that row IS the association.</Path>
            <Path name="📦 Kits">A 4.6 kit is a real item record — the sales face of a set, with contents, a finish matrix (which finishes it sells in — tab 7's dropdown reads exactly this), and per-customer pricing rows. The floors never see the kit; orders explode to its contents. (Tab 7's saved kits are counter templates — a different thing.)</Path>
            <Path name="🔗 Plates & 🦾 Arms">Declare once which plates are included with their arm ($0 on the quote) and which are cover-plate upgrades billing only the upcharge — and which arms are the exceptions that don't carry a free plate. The quote then says so at every price level.</Path>
            <Path name="Imports">⬆ Control File (their SKUs + prices) and ⬆ Kit Sheet both preview a full diff — NEW / CHANGED / SAME / NOT IN LIBRARY — before anything is written. Blank cells never erase a typed price.</Path>
        </Screen>

        <div style={S.note}><b>What lives where:</b> who they are and what their portal shows → <b>tab 10 (CRM)</b>. What they call our parts, what they pay, checkout items, kits and fees → <b>4.6</b>. What every customer sees on a flow → <b>tab 11</b>. Counter shortcuts → <b>tab 7</b>.</div>
    </div>
);

const SECTIONS = [
    { key: 'WO', label: 'Work Orders', comp: WorkOrdersGuide },
    { key: 'OC', label: 'Orders & Customers', comp: OrdersCustomersGuide },
];

const UserGuideTab = () => {
    const [section, setSection] = useState('WO');
    const Active = (SECTIONS.find(s => s.key === section) || SECTIONS[0]).comp;
    return (
        <div style={S.wrap}>
            <h1 style={S.h1}>User Guide</h1>
            <p style={S.stand}>How the system works, screen by screen — what each one is for, when to use which, and the edges to know. Written from the code as it actually behaves, kept current as it changes.</p>
            <div style={S.chips}>
                {SECTIONS.map(s => (
                    <button key={s.key} onClick={() => setSection(s.key)} style={S.chip(section === s.key)}>{s.label}</button>
                ))}
            </div>
            <Active />
        </div>
    );
};

export default UserGuideTab;
