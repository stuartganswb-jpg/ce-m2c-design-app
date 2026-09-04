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
                    <tr><td style={S.td}>Order the manufacturing for an <b>Order Entry sale</b> (made-to-order lines)</td><td style={S.td}><b>12.5 Stock View → 🧾 Order Entry Needs</b></td><td style={S.td}>Client work keeps its SALES link: each SO shows its lines, finish, need-by and notes, with the linked WO/PO status — generate anything missing from there. Never order client work as stock.</td></tr>
                    <tr><td style={S.td}>Send a custom sales order to the floors</td><td style={S.td}><b>13. RTG Dispatch</b></td><td style={S.td}>Not these screens: quotes become sales orders and RTG splits them to shop / finishing / packaging on its own (⚡ Auto-Release ON). Nothing to press — the row's chip says what it is waiting on.</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>1 · Master Library <span style={S.tabno}>(tab 4 — one item at a time, from its card)</span></h2>
        <Screen title="Generate Production Work Order" tag="five distinct paths">
            <Path name="Raw build" goes="RTG record → shop floor, on its own · no stock check">No finish selected → <em>Push to RTG Dispatch</em>. One work order, routed to the <b>shop</b> the moment it is created (never "route-open" any more), with the root's NetSuite work order queued at creation when the item is a NetSuite assembly. RTG holds the record and releases it on its own once its gates are clear — nobody presses Push to Shop.</Path>
            <Path name="Outsourced finish" goes="WMS Plating (+ shop WO when the core is short) · live check, blocking">An item ending in a plated finish (…/EP1) becomes a <em>plating demand</em> on the WMS plating tab, one per mill core the BOM names. This path runs a <b>blocking</b> live stock check on the cores first: every core gets its demand, and a core that is short also gets a milling work order for the <em>shortfall</em>, parked in RTG and released to the shop on its own. If NetSuite can't be reached, nothing is created at all.</Path>
            <Path name="In-house finishing run" goes="Finishing floor (direct) + NetSuite WO · live check, shorts prompt the cascade">Pick an In-House Finish → <em>Create &amp; Push to Finishing Floor</em>. Explodes the BOM, runs a <b>live component check</b>, shows the pull lines, and releases <b>straight to the Setup Queue</b> — RTG keeps the ledger copy, and a real NetSuite work order is queued so components commit.</Path>
            <Path name="Make-up cascade" goes="WMS Convert + RTG-parked shop WOs">When that check finds shorts, the cascade offers the prerequisite orders: a /P core short becomes a <em>Convert to-do</em>, and if the raw behind it is also short, a shop WO for the difference. You confirm each quantity — batch it up rather than ordering the exact shortfall.</Path>
            <Path name="Just For Paint" goes="Finishing floor (direct) · existence check only">Only on the JFP template card — see below.</Path>
        </Screen>
        <div style={S.rule}><b>Just For Paint</b> is a paint run with <em>no assembly and no NetSuite work order</em>. Type the NetSuite item #, optionally a <em>Pull Pieces From</em> item (repainting existing stock), pick the finish and quantity. The floor picks the pull item (a minus adjustment), paints, and packing closes it with a plus adjustment of the painted item into the scanned bin — adjustments, not an assembly build, because there is nothing to build. It verifies the items <em>exist</em> in NetSuite but never checks <em>quantity</em> — confirm the pieces are really on the shelf first.</div>

        <h2 style={S.h2}>2 · Stock View <span style={S.tabno}>(tab 12.5 — batch builders over the whole catalog)</span></h2>
        <Screen title="The builders" tag="type quantities, press once">
            <Path name="WO builder (grid)" goes="RTG record → finishing or shop, on its own · live component pre-check">Type quantities on finished items → <em>Push Work Order to RTG Dispatch</em>. Every row is routed by its item code and carries its complete floor job from the start: a finish suffix (…/BS, /N25) is finishing work with the recipe stamped; a raw code is shop work; a <b>/P</b> row becomes a <em>Convert to-do</em> on the WMS (phosphating is a bulk convert, never a work order); a <b>plated</b> code (…/EP1) is refused here — raise it as a plating demand from the PO builder's plating split. Assemblies get their BOM exploded, a 4/6 ft pole gets its rod cut first, and a component still milling gates the order. RTG releases it on its own when the gates are clear — the same document the Snapshot writes.</Path>
            <Path name="PO builder" goes="draft POs → preview → NetSuite · WMS Plating (+ auto shop WO on shortfall)">The same grid, buying instead of making. Vendor lines group into one <b>draft</b> PO per vendor — see <em>How a purchase order goes out</em> below. Lines wearing a plated finish become <em>plating demands</em> — and if the raw base behind one is short, a milling WO for the shortfall is raised <b>automatically</b>, routed to the shop and released by RTG on its own. The PO to the plater is <em>not</em> raised here: the WMS issues it at the weekly plating shipment. That check reads the last "Pull NetSuite Stock" — pull first, or it assumes zero.</Path>
            <Path name="RAW view" goes="RTG (parked, SHOP route) or vendor PO"><em>Generate Core Orders</em> — raw mill cores routed make-vs-buy: in-house → shop WOs (routed, NetSuite root WO queued at creation, released by RTG on its own); vendored → the vendor PO modal. Items flagged <b>both</b> open the modal defaulted to <em>make in-house</em>.</Path>
            <Path name="TIER view" goes="shop / Convert / Plating / finishing, one press"><em>Generate Tier Orders</em> — the H1 three-tier pass. Raw base → shop WO or PO; <b>/P → a Convert to-do</b> (never a work order — the WMS convert IS the stock movement); <b>/EP → a Plating to-do</b>, plus a milling work order for whatever share of the core nothing covers (on hand + inbound + the base row's own order, less the converts); painted variants → finishing WOs. If converts would eat more raw base than exists, the confirm still warns — converts never auto-order the base, because the base row is right there.</Path>
        </Screen>

        <h2 style={S.h2}>3 · Stocked Sales Snapshot <span style={S.tabno}>(inside 12.5 — the sales-driven replenisher)</span></h2>
        <Screen title="Generate Orders" tag="recommendation → one pass">
            <Path name="The recommendation">Reads 12 months of NetSuite sales per item plus live available + on-order, and recommends an order quantity. Red <b>URGENT</b> flags come from the warehouse — a picker hit a shortage on a real job.</Path>
            <Path name="Bought items" goes="draft POs → preview → NetSuite">One <b>draft</b> purchase order per vendor, holding only that vendor's items, previewed straight after the press — see <em>How a purchase order goes out</em> below. A line with no matching NetSuite vendor is refused, never guessed.</Path>
            <Path name="Made items" goes="RTG (parked, verbatim release) + NetSuite WO at release">One WO per row, parked in RTG carrying a <b>complete pre-built finishing job</b> — recipe, sizes, pole counts, BOM pull lines, notes. Release sends exactly that document to the Setup Queue and queues the real NetSuite work order. What you see parked is what the floor gets. Rows route by what the item is: a <b>/P</b> becomes a Convert to-do instead, a <b>raw</b> code is routed to the shop with its NetSuite root work order queued at creation, and a <b>plated</b> code (…/EP1) becomes a <em>plating demand</em> for its mill core on the WMS Plating tab — with one live read of the core's stock, and a milling work order for whatever the shelf cannot cover (the plater's PO is issued by the WMS at the weekly shipment, never here). RTG releases every one of them on its own once its gates (rod cut, convert, components) are clear.</Path>
            <Path name="In-house w/ vendor">A chooser per item: PO or WO. Heads-up: this modal defaults to <em>PO</em>, while RAW/TIER default the same both-sourced items to <em>make</em>.</Path>
            <Path name="Pole cuts" goes="cut order gate → then release">A 4 ft or 6 ft pole order automatically raises a <em>cut order</em> from 8 ft stock first, and the WO is <b>gated</b> until the warehouse completes the cut (WMS → Rod Cuts → Cuts for Finishing). The cut posts the NetSuite movement and prints the setup label.</Path>
            <Path name="Component pre-check" goes="convert gate → then release (new 26 Aug)">Before a finished-goods WO is written, its component pull lines are checked against <b>live NetSuite stock</b>. A short <b>/P core</b> raises a Convert to-do and the WO parks <b>⇄ AWAITING CONVERT</b> in RTG — Auto-Release skips it, and the gate clears itself the moment the WMS posts the convert. If the raw behind the /P is short too, a component <b>shop WO</b> (milling) is parked alongside; the convert can't post until the shop makes the raw, so the chain orders itself. Same check on the WO grid and the scrap re-make.</Path>
            <Path name="⇄ Convert suggestions">The ⇄ button attaches a donor suggestion ("convert 5 × …/EP2 back to raw") that rides the WO to the floor. It suggests — the operator runs the conversion.</Path>
        </Screen>

        <h2 style={S.h2}>How a purchase order goes out <span style={S.tabno}>(new 2 Sep — every screen that buys)</span></h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>Step</th><th style={S.th}>What happens</th><th style={S.th}>Where</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}><b>1 · Create</b></td><td style={S.td}>Enter quantities and press Generate. Lines group by vendor: one PO each, holding <b>only</b> that vendor's items, saved as a <b>draft</b>. Nothing has been sent. A line that belongs to a sales order keeps that SO number <em>on the line</em>.</td><td style={S.td}>Stock View — the grid's PO builder, the Snapshot, RAW / TIER, and the Order Entry review</td></tr>
                    <tr><td style={S.td}><b>2 · Preview</b></td><td style={S.td}>The whole set is shown back — every PO, its lines, its total, the vendor's minimum if we hold one, and a warning if the vendor is not assigned to the buying subsidiary (NetSuite refuses those and misleadingly blames the <em>location</em> field). Nothing is committed. <em>Leave as drafts</em> is a real answer; the toolbar keeps a <b>🧾 draft PO</b> count so they are never lost.</td><td style={S.td}>the window that opens after the press</td></tr>
                    <tr><td style={S.td}><b>3 · Approve</b></td><td style={S.td}>Every line is pushed to NetSuite. <b>Only NetSuite can mint a PO number</b>, so this is where the real number comes from; it stamps back onto the record on its own, usually within a minute. A line with no NetSuite item id refuses the whole PO rather than posting a short one.</td><td style={S.td}>the preview → 11.1 NetSuite Sync Queue shows it posting</td></tr>
                    <tr><td style={S.td}><b>4 · Send</b></td><td style={S.td}>With its number on it, the PO can go to the vendor — your own mail client opens with the order, exactly as a sales order leaves the CRM. Before the number arrives the button says so and refuses.</td><td style={S.td}>10. External Co-Op → the vendor → Purchase Orders</td></tr>
                    <tr><td style={S.td}><b>5 · Acknowledge</b></td><td style={S.td}>Days later the vendor confirms, usually with a ready date. Record it on the PO header: their order number, their ready date, a note. That date is the <em>vendor's</em> commitment and is kept separate from the ready date we promise a customer.</td><td style={S.td}>the same card</td></tr>
                </tbody>
            </table>
        </div>
        <div style={S.note}><b>The floors never see a purchase order.</b> The warehouse will, when receiving against one. Until that tab exists, a delivery is received the way it always has been.</div>

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
                    <tr><td style={S.td}>Library · outsourced/plating</td><td style={S.td}>live, <b>blocking</b></td><td style={S.td}>demand for every core; a milling WO for the shortfall, automatically parked</td></tr>
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

        <h2 style={S.h2}>⚡ Auto-Release — RTG is the record and the control <span style={S.tabno}>(RTG 13, rebuilt 4 Sep)</span></h2>
        <p style={S.p}><b>Every order from every door lands on RTG Dispatch</b> — CPQ, Order Entry, Stock View, the Snapshot, the Library — and RTG sends it on by itself. There are <b>no Push buttons</b> any more. The ⚡ button on the RTG toolbar is the <b>kill switch</b>: ON, every approved record whose gates are clear goes to its floor <b>one at a time</b>, through the door its type names (a CPQ sales order splits to shop + finishing + packaging; a stock work order goes to finishing <b>and queues its NetSuite work order at the same moment</b>; a shop route goes to the shop; an Order Entry line goes to finishing with the sales order as its NetSuite record). OFF, nothing releases and every chip says so. Turning it ON does not flood the floor: orders parked <em>before</em> the switch wait for a person.</p>
        <p style={S.p}><b>Read the chip, don't hunt for a button.</b> Each parked row carries one chip in the same words everywhere: <em>awaiting SO accept · awaiting NetSuite WO # · awaiting component milling · awaiting phosphate convert · awaiting rod cut</em> (the gates — each clears itself when the WMS, the shop or NetSuite does its part), or why nothing will take it (<em>auto-release is OFF · parked before the switch · stopped · no route on this record</em>), or <em>releasing…</em>. Every parked record also names its <b>source</b> (which screen parked it) and its route; a record with no source is a red line — report it.</p>
        <p style={S.p}><b>One supervisor override.</b> Open the order (<em>View</em>): the red <b>⚠ Supervisor override — release now</b> button is the only manual release in the app. It tells you what the engine is waiting on, asks you to confirm, logs your name, and releases through the same door the engine would — so even a forced release is anchored to NetSuite. Nobody is ever <em>required</em> to press it.</p>
        <p style={S.p}><b>Order Entry sales orders are on the board too</b> (grey "Order Entry · stocked — record only" group under Sales Orders): the warehouse picks and packs those straight off the shelf, so the card is a record with a WMS chip (<em>awaiting NetSuite · in the pick queue · open on a tablet · picked · packed · shipped</em>) and its linked work orders — never a split button.</p>
        <p style={S.p}><b>Plated custom parts.</b> A custom order whose finish is plated shows <em>Custom shop · At the plater since &lt;date&gt;</em> from the moment the shop finishes it until the WMS receives the plated pallet and builds it back; packing refuses in between. The four custom-parts states every screen shares: <em>Pending → In Process → Sent to Plating → Complete</em>.</p>
        <p style={S.p}><b>Finish as available.</b> The default is to wait and finish an order complete when every part is in. The exception is a flag on the sales order — <b>⚡ Finish as available</b> on the RTG card or the WMS SO Pack card — set with a reason, logged with who and when; parts then go to finishing as they arrive.</p>
        <p style={S.p}><b>Purchase orders.</b> The Purchase Orders panel shows <b>every open PO</b> for the brand — Draft, Approved, queued, pushed, sent to the vendor, partially received — with its lines, where each line came from, what has arrived and the running total. <b>✓ Approve → NetSuite</b> is the one deliberate act (it gets the PO #); <b>✉ Mark sent to vendor</b> records the send. A PO disappears from the board only when everything has arrived or someone closes it.</p>
        <p style={S.p}><b>Where a stuck order says why.</b> The chip on RTG; the Setup Queue card (it refuses <em>Start Setup</em> while the order's rod cut is still open, and names the cut); the WMS pending window; <em>Where is it?</em> on every screen. Scrap reported at QC reaches the RTG row in red ("⚠ SCRAP n reported on the floor"). Closing an order anywhere closes it everywhere and cancels its open rod cut.</p>

        <h2 style={S.h2}>Edges to know <span style={S.tabno}>(true today — being scheduled for fixes)</span></h2>
        <ul style={{ paddingLeft: '4px', listStyle: 'none' }}>
            <li style={S.edge}>• <b>Every stock writer routes by what the item IS</b> (one writer since 2 Sep): the grid, the Snapshot, Raw Cores, the PO builder's core-short order and the Library card all park the <em>same document</em> — routed, source-stamped, gated, complete floor job attached, released by RTG on its own. A /P becomes a Convert to-do; a plated code is refused as a work order and says where to raise it. No stock order parks "route-open" any more. RAW/TIER remain the purpose-built views for cores and H1 families.</li>
            <li style={S.edge}>• <b>⚖ BOTH items always ask, on every screen</b> (unified 28 Aug): the FIN snapshot's chooser now catches the BOTH flag too and defaults those rows to the <em>work order</em> — the same safe answer as the RAW/TIER vendor modal. Plain in-house-with-vendor rows in that chooser still default to PO — read the modal, don't just click through.</li>
            <li style={S.edge}>• <b>Poles released from the Master Library run as small parts.</b> The Library's direct-to-floor path doesn't carry pole/size scheduler keys yet — release pole runs from Stock View or the Snapshot.</li>
            <li style={S.edge}>• <b>Pull NetSuite Stock before using the PO builder's plating split</b> — its short-check reads the session cache and assumes zero without a pull.</li>
            <li style={S.edge}>• <b>On-Order counts NetSuite only.</b> A work order parked on RTG behind a gate (or with Auto-Release OFF) has no NetSuite work order yet, so the snapshot cannot see it — read the RTG chip before re-generating the same shortfall.</li>
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
            <Path name="8 · Checkout">Verify customer → shipping (saved NetSuite address or custom drop-ship, optional shipping $ that lands on the NetSuite header) → job name, sidemark, customer PO #, internal memo (never customer-facing) → <b>Need-by date</b> (the customer's date, optional — leave it blank if none was given; the app never invents one) and <b>Production notes</b> (ride to the floor and the pack station, never to the customer) → <b>Add-ons &amp; fees</b> (rush, packaging, strike-offs — each becomes its own line; percentage fees compute off the configured subtotal, so they never compound). The 🗓 <b>ready date</b> beneath the fields is what the finish class promises: a <b>painted</b> finish (P codes) is 4 weeks, a <b>plated</b> finish (EP / MEP) is 6; ticking the <b>Rush</b> fee shortens them to 2 and 4. A need-by earlier than the ready date without the Rush fee is flagged red and asks before saving.</Path>
            <Path name="9 · Save = send" goes="CRM pipeline · RTG board · NetSuite — automatically"><b>💾 Save as Quote</b> puts it on the customer's pipeline and queues the NetSuite estimate; <b>🛒 Save as Sales Order</b> also puts it on the RTG board and queues the NetSuite SO. The real numbers write back onto the record within ~a minute. No approve-then-push relay — saving is sending. Whichever door an order comes through — CPQ, Order Entry, or Approve in the CRM — the sales order carries <b>one header</b>: customer, PO, sidemark, need-by, ready date, ship-to, production notes, and the <b>finish recipe stamped at save</b> (the floor reads it straight off the order; it says PENDING only when the quote carries no finish at all). Every line that carries a finish also says whether that finish is <b>outsourced</b>, which is what routes a plated part to WMS Plating instead of the finishing floor.</Path>
            <Path name="10 · Documents">A print window opens with the Quotation, the Factory Router (BOM), and one Engineering Drawing page per Vision drawing. Drawings also file to the customer's CRM record.</Path>
            <Path name="Reopening">From the CRM card, <b>Reopen CPQ</b> restores the whole session — cart, customer, sidemark, PO, need-by, production notes, shipping (a quote saved before 3 Sep 2026 reopens with need-by and notes blank — never with a made-up date). Re-finalizing merges into the SAME quote. If it already reached NetSuite, re-pushing creates a NEW estimate — close the old one there.</Path>
        </Screen>

        <h2 style={S.h2}>7 · Quick Ship / Order Entry <span style={S.tabno}>(stocked orders — flat lines, no BOM)</span></h2>
        <Screen title="The counter" tag="stock · to-be-finished · kits · fees">
            <Path name="Portal requests">Customer-built stock quotes from the portal land at the top — <b>Load into cart</b> fills customer, job and every line with zero re-entry, repriced at today's prices.</Path>
            <Path name="Customer & scope">Pick the customer, then <b>Collection Scope</b>: their assigned collections group first, but staff are never blocked from the rest. Scope is alias-aware — the customer's own codes pull in the real stocked items they point to.</Path>
            <Path name="Adding lines">Four quick-add rows: <b>Stocked item</b>; <b>To Be Finished</b> (raw part + finish, pre-filled with this customer's price, editable for phone orders); <b>Fee</b> (percentage fees compute off the order and move as lines change); and the customer's <b>checkout items</b> — the same 4.6 list CPQ checkout shows. Pack-sold items count in packs on the invoice and in eaches everywhere else.</Path>
            <Path name="Kits">Prebuilt kits filed by collection — pick the finish and every component swaps to its /CODE variant; missing variants are named, never half-built. <b>$ Kit Pricing</b> sets the base kit price and per-customer kit prices (the kit price distributes across the lines so the SO totals exactly it). Traverse kits resolve from the customer's pasted kit code, with motor, projection and finish handled.</Path>
            <Path name="Item missing?">Type the code in the "Item missing?" box — it replays every filter and names the one that rejected it, so you know whether it's scope, diameter, or stocking.</Path>
            <Path name="Create the record" goes="record saved HERE first · staged NetSuite sync · WMS lists it when NetSuite accepts"><b>Create Sales Order</b> or <b>Create Quote</b> — same cart, same fields. The record saves locally first; the NetSuite write posts through the staged sync in ~a minute and the real number replaces the app id. A quote now also lands on the customer's CRM pipeline. An SO enters the warehouse's Stock tab only once NetSuite accepts it. The sales order carries the <b>same header CPQ writes</b> — PO, sidemark, need-by, ship-to, production notes, the to-be-finished lines' finish codes as its recipe — and a <b>ready date</b> from the finish class (painted 4 weeks, plated 6; a Rush fee line on the order shortens them to 2 and 4).</Path>
            <Path name="To-be-finished → floor" goes="recorded at save · generated from Stock View → 🧾 Order Entry Needs (review gate)">A sales order's <b>To Be Finished</b> lines are <b>recorded</b> on the order at save — the raw part, the finish, and whether that finish is outsourced (the Outsource Finishes tab is the authority). Nothing fires sight-unseen: the work is generated from <b>Stock View → 🧾 Order Entry Needs</b>, where the review modal shows live stock (with units), the sourcing-resolved routing and the NetSuite work-order plan before anything writes. An <b>in-house finish</b> → a finishing work order parked in RTG under the customer's name, recipe = the chosen finish, pulling the /P of each component exactly like a CPQ custom, with the <b>component pre-check</b> (short /P → Convert to-do + gate; short raw → component shop WO). An <b>outsourced finish</b> never becomes a finishing WO: per mill core, in stock → a <b>plating demand</b> on the WMS Plating tab; core short → a shop WO to mill it first, plate after. Never order these from the Stock View grid or the snapshot: those screens see BOM demand, not the finish. On the WMS Stock card those lines read <b>FROM FINISHING / FROM PLATING — do not pull raw</b>.</Path>
            <Path name="Sales order → invoice">The record is a <b>sales order</b> (CRM shows it under Order Entry — Sales Orders; the 📄 Order button prints the confirmation). The document becomes an <b>invoice</b> only at fulfillment — once packed/shipped, 🧾 Invoice appears and <b>Match NetSuite Invoice #</b> ties it 1:1 to the NetSuite bill before sending.</Path>
        </Screen>

        <h2 style={S.h2}>4.6 · Customer Collections <span style={S.tabno}>(their numbers, their prices, their catalog)</span></h2>
        <Screen title="One customer × one collection" tag="live in CPQ, Quick Ship & the portal on save">
            <Path name="The pickers">Pick the <b>customer</b>, their <b>Prices at</b> level (the one place the default level is set), the <b>mode</b> (Collection · Fees · Kits · Checkout Items · Plate Pricing · Arms &amp; Returns), and the <b>collection</b>. Nothing writes until <b>💾 Save</b>; every bulk action means "all rows currently shown" — search first.</Path>
            <Path name="The grid">Per item: <b>Base $</b> (OUR price — changing it changes it for everyone), <b>Their SKU</b> (what they call it — prints on quotes, spec sheets, the portal), <b>Their Net $</b> (what they pay us — blank means base price), <b>Their Sales $</b> and <b>Their Retail $</b> (their tiers). A ⤿ badge marks aliases — edit the MAIN item; the alias is display identity only.</Path>
            <Path name="⚙ P / EP editor">Per-row painted/plated/own price tiers with their pattern #s. The contract: <b>blank = no price at that tier</b> (falls back to standard); <b>"$0 · w/ arm" = explicit $0</b> (the arm carries the value). ＋ Alias creates the customer-facing item number; quotes and the portal show it, the floor and NetSuite keep the real code.</Path>
            <Path name="🛒 Checkout Items — two homes">Customer-specific items: tick <b>For [Customer]</b> here and price the same row — they appear on CPQ checkout AND Quick Ship for that customer. Standard items every customer sees: the <b>Std</b> tick here (item-wide) or the flow's own list on tab 11. Never tick anything a flow already charges (french returns, cover-plate upcharges) — that double-bills. Note: a customer-specific tick does NOT reach their portal checkout — portal needs the Std tick.</Path>
            <Path name="💲 Fees">The brand's whole fee catalogue: flat-per-unit or percentage-with-minimum, and the <b>Portal</b> tick for customer-self-serve. Don't create a duplicate fee for a customer — put their part # in Their SKU on the existing row; that row IS the association. The <b>Rush</b> fee is also what shortens an order's ready date (painted 4 → 2 weeks, plated 6 → 4) on CPQ checkout and in Order Entry — a fee item counts as rush when its type or name says RUSH or EXPEDITE.</Path>
            <Path name="📦 Kits">A 4.6 kit is a real item record — the sales face of a set, with contents, a finish matrix (which finishes it sells in — tab 7's dropdown reads exactly this), and per-customer pricing rows. The floors never see the kit; orders explode to its contents. (Tab 7's saved kits are counter templates — a different thing.)</Path>
            <Path name="🔗 Plates & 🦾 Arms">Declare once which plates are included with their arm ($0 on the quote) and which are cover-plate upgrades billing only the upcharge — and which arms are the exceptions that don't carry a free plate. The quote then says so at every price level.</Path>
            <Path name="Imports">⬆ Control File (their SKUs + prices) and ⬆ Kit Sheet both preview a full diff — NEW / CHANGED / SAME / NOT IN LIBRARY — before anything is written. Blank cells never erase a typed price.</Path>
        </Screen>

        <div style={S.note}><b>What lives where:</b> who they are and what their portal shows → <b>tab 10 (CRM)</b>. What they call our parts, what they pay, checkout items, kits and fees → <b>4.6</b>. What every customer sees on a flow → <b>tab 11</b>. Counter shortcuts → <b>tab 7</b>.</div>
    </div>
);

// Rod Pieces: the offcut ledger — 6.5 setup, the cut-station panel, the shelf screens. (2026-08-27)
const RodPiecesGuide = () => (
    <div>
        <h2 style={S.h2}>The idea in one minute</h2>
        <p style={S.p}>Rods, poles and fascia are stocked in full lengths (12, 20 or 22 ft), sold by the foot — and every
        sale leaves an offcut. NetSuite keeps <b>feet</b>, which is the right number for money and the wrong number for
        the saw: "200 ft available" can be a pile of 3 ft stubs that will never make a 9 ft pole. So the app keeps a
        <b> piece ledger</b> alongside: full rods on the shelf stay an unlabelled count, and the moment a rod is cut,
        the remainder gets a <b>piece #, a label and a ledger row</b>. From then on the system can answer the real
        question — "what's the longest piece we actually have?" — and recommend which piece to pull for the next order.</p>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>You want to…</th><th style={S.th}>Go to</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Declare how a rod item is stocked (12 / 20 / 22 ft) so the tools switch on for it</td><td style={S.td}><b>6.5 Tools, Specs &amp; FAQs → Rod Piece Stock</b></td></tr>
                    <tr><td style={S.td}>See every offcut, reprint a label, scrap a piece</td><td style={S.td}><b>6.5 Rod Piece Stock</b> (HQ) or the same shelf panel on <b>Shop Floor → Custom</b></td></tr>
                    <tr><td style={S.td}>Decide which rod to pull for an order's cuts</td><td style={S.td}>The <b>✂ Rod Pieces — Cut Source</b> panel on the active shop custom card</td></tr>
                    <tr><td style={S.td}>Get the offcuts standing in the shop today into the system</td><td style={S.td}>Either shelf panel → <b>＋ Add &amp; label</b></td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>Setting up <span style={S.tabno}>(6.5 → Rod Piece Stock — once per rod item)</span></h2>
        <Screen title="The declaration" tag="a row here is the on-switch">
            <Path name="1 · Piece length">At the bottom of the tool, add a row per stocked rod item: the item code and the length it arrives in (ft), optionally its home bin. Finish variants match automatically — declaring the base code covers its /P and plated spellings.</Path>
            <Path name="2 · Today's shelf">Walk the rack once with <b>＋ Add a standing piece</b>: item, measured length, brand — each add prints the piece label to stick on the pole. Full uncut rods are NOT added; they stay a shelf count.</Path>
            <Path name="No row, no tool">An item without a declaration gets no recommendation panel at the saw — the system won't guess how something is stocked.</Path>
        </Screen>

        <h2 style={S.h2}>At the saw <span style={S.tabno}>(Shop Floor → Custom → the active card)</span></h2>
        <Screen title="✂ Rod Pieces — Cut Source" tag="recommend → log → label">
            <Path name="1 · Read the recommendation">Every cut on the order gets a line: "USE PIECE P-… (7 ft) — scrap the 12&quot;" or "CUT NEW 12 ft ROD — label the 72&quot; remainder". The dropdown lists the alternatives if the recommended pole isn't where it should be.</Path>
            <Path name="2 · Cut, then Log Cut">Make the cut, press <b>✂ Log Cut</b>, confirm. The ledger updates for every tablet at once — a piece two saws both wanted can only be spent once.</Path>
            <Path name="3 · Label the remainder" goes="the label IS the inventory">If the remainder is worth keeping the piece label prints immediately — put it on the remaining pole before it leaves your hand. An unlabelled offcut doesn't exist.</Path>
            <Path name="4 · Scrap the stub">If the remainder is too short the panel says so: bin it, done — the feet post to NetSuite by themselves.</Path>
            <Path name="Multi-cut orders">Left/centre/right cuts are matched one by one, and a remainder from the first cut is offered to the second. <b>Mitered</b> poles are the exception: angled joints must match, so ALL pieces come from ONE rod — the panel combines them for you.</Path>
        </Screen>
        <div style={S.rule}><b>The waste rule</b> (why the panel says what it says): always use an offcut when possible — a 7 ft piece is the right answer for a 6 ft order. Cutting a piece may leave at most <b>18"</b> of scrap, and a keepable remainder must be at least <b>36"</b>. In between is the dead zone: from a 96" piece, a 72" order would leave 24" — unusable AND too wasteful, so take a new rod and leave the piece for an order it fits. An 80" order leaves 16" — use the piece, scrap the stub. You can override a dead-zone call, but the panel makes you say so.</div>

        <h2 style={S.h2}>The shelf <span style={S.tabno}>(both vantages — same ledger)</span></h2>
        <Screen title="Rod Piece Inventory" tag="HQ 6.5 · Shop Custom tab">
            <Path name="Per item">Offcut count, total feet in pieces, and the number that matters: the <b>longest piece</b>. Expand for every piece — length, age, which order it came from.</Path>
            <Path name="🖨 / 🗑">Reprint a lost label; scrap a damaged or hopeless piece. Scrapping posts the feet to NetSuite automatically.</Path>
            <Path name="🧹 The sweep">Anything under 36" is scrap by standing rule — when stubs appear (a dead-zone override, a miscut), the banner offers to sweep them all in one press.</Path>
        </Screen>

        <div style={S.note}><b>NetSuite stays feet-based — and honest.</b> Selling by the foot bills the feet; an offcut is still sellable inventory, so nothing moves in NetSuite when a piece is born. Only <b>scrap</b> adjusts NetSuite (rounded up to the foot, so the count can only ever understate the shelf). Postings ride the same staged queue as everything else — 11.1 → NetSuite Sync Queue if one needs a look; a posting that couldn't identify its item shows a <b>⟳ post to NS</b> retry in the ledger's history view.</div>

        <h2 style={S.h2}>Edges to know</h2>
        <ul style={{ paddingLeft: '4px', listStyle: 'none' }}>
            <li style={S.edge}>• <b>This is not the WMS Rod Cuts tab.</b> That flow cuts stocked 8 ft rods into stocked 6/4 ft <em>items</em> (one NetSuite item becomes another). This ledger tracks <em>offcuts of the same item</em> born at the custom saw. Log each cut in the flow that raised it — never both.</li>
            <li style={S.edge}>• <b>Pieces belong to a brand.</b> A CE order is only offered CE pieces — matching how NetSuite splits the stock. Pieces added without a brand show everywhere.</li>
            <li style={S.edge}>• <b>Full rods never get labels.</b> If someone labels a full rod as a piece, scrap-math still works but the shelf count reads low — labels are for remainders only.</li>
            <li style={S.edge}>• <b>Log the cut when you make it,</b> not at shift end — the recommendation for the next order is only as honest as the ledger at that moment.</li>
        </ul>
    </div>
);

// ── WORKING ON THE APP ──────────────────────────────────────────────────────────────────────────
// A different audience from the rest of this guide: not "how do I run this screen" but "how does
// the system hang together, and what breaks it". Written for Stuart and anyone helping him change
// the app — so it states rules and diagnostics, not file paths. The engineering-level companion is
// APP_ARCHITECTURE_BRIEF.md in the repo.
const AppWorkGuide = () => (
    <div>
        <p style={S.stand}>
            The rest of this guide is for running the system. This section is for CHANGING it — the
            handful of rules that keep one screen agreeing with another, and the reasons a change can
            look like it did nothing.
        </p>

        <h2 style={S.h2}>The principle everything else follows from</h2>
        <div style={S.rule}>
            The app was built around the H1 items — all new, created clean, identity and routing
            stamped correctly from birth. That setup is the reference model. Nearly every recurring
            problem started when the system was opened to older legacy items and workarounds
            accumulated to cope with them. A legacy accommodation lives at the EDGE — an adapter when
            data is imported or read — and never bends the path the new collections travel.
        </div>
        <p style={S.p}>
            The practical form of that: <b>throughout the app we should see the SAME data.</b> One
            screen must reflect what is actually happening across the whole ecosystem. When two
            screens disagree about the same fact, that is the bug — not a display problem.
        </p>

        <h2 style={S.h2}>The mistake that causes most of the bugs</h2>
        <p style={S.p}>
            The same fact stored under different names in different places, then read with a test
            that only knows some of them. It never looks like that from the floor — it looks like a
            blank card, or a pick list asking for the wrong part.
        </p>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>What was reported</th><th style={S.th}>What it actually was</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>“Orders from Stocked Sales show no item information”</td><td style={S.td}>The item code was being written seven different ways. The reader knew six of them.</td></tr>
                    <tr><td style={S.td}>“CP poles are being treated as small parts”</td><td style={S.td}>Four places asked “is this a pole?” four different ways. Only some knew about RODS. The items were tagged correctly the whole time.</td></tr>
                    <tr><td style={S.td}>“There is no Cut icon on the 4-ft rods”</td><td style={S.td}>The tool decided from what the item CODE looked like instead of what the item was, so rods named another way had no tool at all.</td></tr>
                    <tr><td style={S.td}>“The images imported but do not show on the items”</td><td style={S.td}>Two tools matched photos to parts by different keys, so each covered parts the other could not see.</td></tr>
                </tbody>
            </table>
        </div>
        <div style={S.rule}>
            Ask what the item IS, not what its code looks like. Ask once, in one place, and have
            everything else use that answer.
        </div>
        <div style={S.note}>
            <b>Before adding a field to anything,</b> check what already holds that fact. Before
            writing a new test for “is this a pole / is this painted / what item is this”, check
            whether the answer already exists somewhere. A second version of an existing rule is a
            future bug with a date on it.
        </div>

        <h2 style={S.h2}>The two product models</h2>
        <p style={S.p}>
            The divisions stock differently, and anything touching BOMs has to know which it is
            looking at. The system tells them apart by one question: does the item have a BOM?
        </p>
        <Screen title="Model A — stocked finished assemblies" tag="Brimar · legacy · H2 Simple Elegance">
            <Path name="Has a BOM" goes="pull exactly what the BOM names">
                The finished code IS a complete NetSuite assembly. Some bill a phosphated component,
                some bill the bare base and are painted straight over it. Both are correct — the BOM
                says which, and it is taken literally.
            </Path>
            <Path name="Why literal">
                NetSuite's assembly build consumes those component lines. Picking anything other than
                what the build consumes is how the app and NetSuite start disagreeing about what left
                the shelf.
            </Path>
        </Screen>
        <Screen title="Model B — custom division" tag="H1 · mill and phosphate only">
            <Path name="No BOM" goes="mill → phosphate → apply the finish">
                Stocked only as the mill core and its /P phosphate. The finished code is not a stocked
                assembly, so the routing IS the answer: pull the item's own /P core. Plated finishes
                take the mill core out to the plater instead.
            </Path>
        </Screen>

        <h2 style={S.h2}>Why a fix can look like it did nothing</h2>
        <ul style={{ paddingLeft: 0, listStyle: 'none', margin: '0 0 18px' }}>
            <li style={S.edge}>• <b>A work order's parts list is a photograph, not a link.</b> It is
                taken when the order is raised and never re-read. Correcting an item does NOT correct
                orders already created from it — that is why screens carry repair buttons (RTG's
                BOM refresh, the backfills in 11.1). Every data fix has two halves: fix the source,
                then repair the open orders. One without the other reads as “the fix didn't work”.</li>
            <li style={S.edge}>• <b>You must hard-refresh (⌘⇧R / Ctrl+Shift+R)</b> after a change ships.
                The browser holds the old version until you do.</li>
            <li style={S.edge}>• <b>Occasionally the site serves old code even when the deploy says
                Ready.</b> If a change is definitely live and definitely doing nothing, that is the
                first thing to suspect — it is fixed by redeploying with the build cache turned OFF,
                not by pushing again.</li>
            <li style={S.edge}>• <b>The NetSuite connection and the customer portal do not deploy with
                the app.</b> They are deployed separately, by hand. A change to either looks exactly
                like a broken feature until it is pushed.</li>
        </ul>

        <h2 style={S.h2}>Changing data in bulk</h2>
        <p style={S.p}>
            Nothing outside the app can read or write live data — that is a deliberate security
            setting, not a limitation to work around. So every bulk correction is a BUTTON inside the
            app, and each one should offer a <b>dry run</b> that reports exactly what it would touch
            and writes nothing.
        </p>
        <div style={S.note}>
            <b>Always run the dry pass and read the list.</b> That is where you find out a rule is
            broader than intended — a pole rule that also catches “rod socket”, a name rule that
            catches more than the names you meant.
        </div>

        <h2 style={S.h2}>Refusing well</h2>
        <div style={S.rule}>
            Refuse only on complete knowledge. Warn when you might be wrong. Never block someone who
            is right.
        </div>
        <ul style={{ paddingLeft: 0, listStyle: 'none', margin: '0 0 18px' }}>
            <li style={S.edge}>• A check that refuses on partial information is worse than no check.
                The operator can SEE the bin is real, so the app just looks broken and gets worked
                around — which spends the trust the check was bought with.</li>
            <li style={S.edge}>• <b>Never invent data to make something succeed.</b> A mistyped bin is
                rejected, never created. An item with no NetSuite id gets its step skipped and named,
                never adjusted against a guessed record.</li>
            <li style={S.edge}>• When something is refused, say where the right answer IS — “that bin
                exists at the other location” is an answer; “not found” is a dead end.</li>
        </ul>

        <h2 style={S.h2}>Pictures — what outranks what</h2>
        <p style={S.p}>
            Items can show a real photograph or a stand-in, and the app now records which is which.
            Uploading real images in <b>14.5 Batch Processor</b> puts them on the item straight away.
        </p>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>Picture</th><th style={S.th}>Where it comes from</th><th style={S.th}>Rank</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Photograph</td><td style={S.td}>Uploaded in 14.5 Batch Processor / Asset Gallery</td><td style={S.td}><b>Always wins.</b> Never overwritten by a stand-in.</td></tr>
                    <tr><td style={S.td}>3D render</td><td style={S.td}>Photographed from the item's own .glb</td><td style={S.td}>Stand-in — a real photo replaces it.</td></tr>
                    <tr><td style={S.td}>Inherited</td><td style={S.td}>A finish variant borrowing its base part's picture</td><td style={S.td}>Stand-in — that finish's own photo replaces it.</td></tr>
                </tbody>
            </table>
        </div>
        <div style={S.note}>
            If images look missing after an import, run <b>4. Master Library → Sync Thumbnails</b>.
            It now says WHY when it finds nothing — either the part already has its own photograph, or
            the gallery has no image for that exact pattern and finish, and it names the codes it
            could not match.
        </div>

        <h2 style={S.h2}>Reporting something</h2>
        <p style={S.p}>
            Use the <b>App Imp.</b> tab, and attach a screenshot whenever you can — the screenshot is
            usually what identifies the cause. Name the work order or item number if there is one.
            Marking a card <b>Tested — it works</b> matters as much as raising it: an untested fix and
            a broken one look identical from here.
        </p>
    </div>
);

// Shop Floor: the custom card's lifecycle, the plating hand-off, the milling pipeline and what
// each step tells RTG. (Brief C, 2026-09-02)
const ShopFloorGuide = () => (
    <div>
        <h2 style={S.h2}>The idea in one minute</h2>
        <p style={S.p}>The shop <b>receives</b> work; it never decides where work goes. RTG sends every job to the shop
        already labelled: a customer's made-to-order piece lands on <b>Custom</b>, a stock milling run lands on
        <b> Milling</b>. If a job shows up on the wrong tab, that is an upstream problem to report — not something to
        work around on the floor. Everything the shop does is reported back to RTG, which is where management sees
        status and closes orders.</p>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>You want to…</th><th style={S.th}>Go to</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Work a customer's custom piece (bent pole, cut-to-length, applied finish)</td><td style={S.td}><b>Shop Floor → Custom</b></td></tr>
                    <tr><td style={S.td}>Accept a stock milling run and get it onto a machine</td><td style={S.td}><b>Shop Floor → Milling</b>, then <b>Scheduler</b></td></tr>
                    <tr><td style={S.td}>Run the op, log the count, pass or fail the run</td><td style={S.td}><b>Shop Floor → Floor</b> (the machine cards)</td></tr>
                    <tr><td style={S.td}>Pick the rod to cut from</td><td style={S.td}>The <b>✂ Rod Pieces</b> panel on the active custom card — see the Rod Pieces section</td></tr>
                    <tr><td style={S.td}>Find out where the rest of an order is</td><td style={S.td}><b>Where is it?</b> in the shop header, or the "Rest of this order" chips on the card</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>The custom card <span style={S.tabno}>(Shop Floor → Custom)</span></h2>
        <Screen title="Staged → Active → Complete & Label" tag="one card, one job, every tablet in step">
            <Path name="Staged" goes="the left column">New orders wait on the left with the item, quantity, cut length and the customer. Review the item (🔍), the SOP or the drawing before you start.</Path>
            <Path name="▶ Start" goes="the small parts release to the warehouse pick at this moment">Moves the job to the active side for every tablet at once. Starting is also the signal the rest of the order waits for: the finishing floor is told the custom half is under way, and the warehouse begins picking the small parts so both halves meet at staging.</Path>
            <Path name="The work">Cut sheets, bend/miter/splice instructions, hanger positions and Vision notes are on the card. A multi-line order gets a checkbox per configuration; an in-house finish gets a <b>phosphate</b> reminder — the parts go to the adjacent station before finishing and you check them off here. These are reminders, not locks.</Path>
            <Path name="No cut list?">An order entered from Order Entry has no geometry, so the card carries a <b>Shop Instruction</b> instead — the standing note for that item (for example "pull from stock, phosphate, hand to finishing"). The note lives on the item in the Master Library and 4.5, so it is the same every time that item is ordered. A card with neither means nobody has written the item's note yet — ask HQ to add it.</Path>
            <Path name="Complete & Label" goes="the label prints; the rest of the order is told">Prints the completion label and tells the finishing floor and the warehouse the custom parts are done, so the order can be staged and packed. The <b>↩ undo</b> strip below the cards puts a job back into production if Complete was pressed by mistake.</Path>
            <Path name="Send to Plating" goes="the OB PLATING bin, then the weekly plater shipment">A piece with an outsourced finish (plated, bronze patina) does not go to the finishing floor at all. Completing it prints the label and sends you to the <b>OB PLATING</b> bin; the warehouse's Plating tab picks it up from there for the weekly plater run. The rest of the order now reads the custom parts as <b>"At the plater since &lt;date&gt;"</b> — not complete — so the warehouse cannot pack the order until the plated parts are received back and built; the receipt flips the status to complete by itself. The finishing floor is never told about a plated part at all.</Path>
        </Screen>
        <div style={S.note}><b>Holds and urgency.</b> A held order shows a red banner and refuses Start and Complete until management clears the hold in HQ. An urgent order shows a brass banner with the need-by date — acknowledge it so HQ knows the floor has seen it.</div>

        <h2 style={S.h2}>Milling <span style={S.tabno}>(Shop Floor → Milling → Scheduler → Floor)</span></h2>
        <Screen title="From RTG to the machine" tag="the order is never deleted, only moved along">
            <Path name="1 · Accept">Pick the stock run from the RTG dispatch list, check the part has a routing, accept it into the machine backlog. The original order stays on file and is marked "In Milling" — HQ can still find, hold or close it at every step.</Path>
            <Path name="2 · Schedule">Push it to the scheduler queue; it becomes one task per operation, in routing order.</Path>
            <Path name="3 · Run and finalize">On the machine card: setup, first-part check, run, then log good and scrap and finalize the op as GOOD or FAILED. Good pieces spawn the next op automatically.</Path>
            <Path name="What RTG sees" goes="the milling run reports, RTG records">When the last op finalizes GOOD, RTG's record of that work order shows <b>built / scrap</b> and the time — and any order waiting on this component releases itself. A FAILED op, or an op with no good pieces, marks the order <b>Failed</b> on RTG with the reason you gave, so a stuck order says why from the board and from Where-is-it. The NetSuite build for a milled item is posted from RTG, not from the shop.</Path>
        </Screen>

        <h2 style={S.h2}>Edges to know</h2>
        <ul style={{ paddingLeft: '4px', listStyle: 'none' }}>
            <li style={S.edge}>• <b>Start is the release.</b> The warehouse pick for the small parts opens when you press Start — an order left staged keeps its small parts waiting too.</li>
            <li style={S.edge}>• <b>An order with no small parts tells finishing nothing.</b> A job that is custom-only (or entirely plated) has no other half; Start and Complete talk to the warehouse only.</li>
            <li style={S.edge}>• <b>A zero-good op stops the order,</b> it does not complete it. Log the failure reason — RTG shows it, and management re-issues from there.</li>
            <li style={S.edge}>• <b>Wrong tab? Don't work around it.</b> A custom job on Milling or a stock run on Custom is a dispatch error upstream; report it rather than accepting it into the wrong pipeline.</li>
        </ul>
    </div>
);

// ── 1.6 / 1.5 AUTHORING (Brief F, 2026-09-03) ────────────────────────────────────────────────
const AuthoringGuide = () => (
    <div>
        <h2 style={S.h2}>The idea in one minute</h2>
        <p style={S.p}>An assembly is built in <b>1.6 Assembly Builder</b> from <b>slots</b>: one .glb file per slot (the left bracket, the rings, the fascia, the rear track…), each holding every choice the customer can pick for that place on the product. Build merges the slot files into one model and writes a <b>section</b> per slot, with a <b>pin</b> per choice carrying its item # and its tags. Everything downstream — the CPQ questions, what the 3D render shows, the spec sheet's pages, the BOM, the floor's router — is read from those tags. So when a product behaves wrongly, the fix is almost always a tag here, not a change to the flow. <b>1.5 Node Grouping</b> is where you look at the model, check what each section claims, and re-tag a section as a whole.</p>

        <h2 style={S.h2}>1.6 · Assembly Builder <span style={S.tabno}>(tab 1.6 — slots in, one assembly out)</span></h2>
        <Screen title="Slots and the load order" tag="new 3 Sep">
            <Path name="The number" goes="becomes the S-number on every node name at Build">Each slot row that holds a file shows a brass <b>#0, #1, #2…</b> badge. That is its <b>load order</b>, and it is the same number Build stamps into the model's node names, so "slot 4" means the same thing on the designer's screen, on Stuart's screen and in the file. SOP and Spec Sheet slots read <em>attach</em> — they ride alongside the model and are never numbered. An empty slot reads <em>—</em> until it holds a file.</Path>
            <Path name="Arranging" goes="numbers follow the order on screen">▲▼ on each slot row moves it. Nothing is named until you press Build, so arrange the rows in the order she actually loads them and the numbers follow. The preflight confirm lists the same numbers as a last check.</Path>
            <Path name="Extend" goes="new slots continue the count">Choosing an existing assembly under Extend shows its current sections with their numbers, greyed, and the new slot rows continue from the next number — so a slot reads as "#7, new" and cannot be mistaken for a re-upload of #3 (which Extend never replaces; it adds a second copy — the preflight warns).</Path>
        </Screen>
        <Screen title="One tag row, both screens" tag="new 3 Sep">
            <p style={S.p}>The tag controls on a slot row (at upload / Extend) and on a <b>Load Choices</b> row (an already-built assembly) are now the <em>same</em> controls. Whatever the designer can tag at upload, Stuart sees identically on Load Choices, and the other way round — traverse role, drive, setup, front/back rod, passing, always-shown, no plate, the materials chips and the projection ticks (including the per-rod form for a double bracket). A tag ticked on either screen writes the same pin.</p>
            <div style={S.note}><b>Basic</b> and <b>no plate</b> both stop the backplate question, but they say different things: <em>basic</em> means the arm and plate are one piece; <em>no plate</em> means this end treatment mounts without one. Tag the fact that is true — the render reads either.</div>
            <div style={S.note}>Traverse tags: the <b>fascia</b> is chosen first; a <b>track</b> is a finish choice whose cut depends on the drive; <b>carriers</b> ride inside and are never offered (tick <em>always</em>, never <em>hide</em>); the <b>ends</b> are real parts that differ by drive. Blank drive or setup means "suits both" — only the genuinely exclusive pairs (single vs double bracket, front vs rear track) need the tag on both sides.</div>
        </Screen>

        <h2 style={S.h2}>1.5 · Node Grouping <span style={S.tabno}>(the slot locator)</span></h2>
        <Screen title="Slots panel" tag="new 3 Sep">
            <Path name="What it lists" goes="the same slots 1.6 loaded, in load order">Above <em>Saved BOM Bindings</em>, one row per slot with its number, its label, how many sections and nodes it holds, and the tags those sections carry. A ⚠ names what is still missing — sections with no category or no position — which on a multi-track assembly is exactly what you are hunting for.</Path>
            <Path name="Finding it in the model" goes="hover glows, Locate locks">Hover a slot row and everything it loaded lights up brass while the rest fades; <b>Locate</b> keeps it lit while you work; ▸ opens the slot to list its sections, each with its own Locate as before. The single-section Locate, hover, Auto-Group and Highlight Unassigned all work exactly as they did.</Path>
            <Path name="Ungrouped" goes="shown, never guessed">Sections no 1.6 slot claims — made by hand here, from Auto-Group, or 2D regions — sit under <em>Ungrouped</em> at the bottom. They are never hidden and never sorted into a slot by guesswork.</Path>
        </Screen>

        <h2 style={S.h2}>Edges to know</h2>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            <li style={S.edge}>• <b>A wrong option on a flow is almost always a wrong tag here.</b> Check the pin on Load Choices (or the section in 1.5) before asking for a flow change.</li>
            <li style={S.edge}>• <b>Extend adds, never replaces.</b> To fix choices in an existing section use Load Choices; re-uploading the slot makes a second copy of its geometry.</li>
            <li style={S.edge}>• <b>The load-order number is minted at Build.</b> Reordering slots before Build is free; after Build the number is in the file and stays.</li>
            <li style={S.edge}>• <b>Regenerate after tagging.</b> Tags are read when the flow is generated; the CPQ shows the new behaviour after the next Regenerate on tab 11.</li>
        </ul>
    </div>
);

const WmsGuide = () => (
    <div>
        <h2 style={S.h2}>The idea in one minute</h2>
        <p style={S.p}>The warehouse is where every loop ends. Parts are <b>picked</b>, orders are <b>packed</b>,
        finished stock is <b>put away</b>, and things that went out — to the plater, to the saw — come <b>back</b>.
        Nothing here decides where work goes; that is decided upstream and the warehouse is told. What the warehouse
        decides is <b>physical</b>: which bin, how many, and whether the pieces in your hands belong to a customer's
        order or to the shelf. Getting that last one wrong is the mistake this whole tab is shaped to prevent.</p>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>You want to…</th><th style={S.th}>Go to</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>Pick the parts for an order the floor has released</td><td style={S.td}><b>Pick Queue</b></td></tr>
                    <tr><td style={S.td}>See a customer order and whether all of its parts are in yet</td><td style={S.td}><b>SO Pack</b></td></tr>
                    <tr><td style={S.td}>Box an order, or put finished stock on the shelf</td><td style={S.td}><b>Packaging Prep</b></td></tr>
                    <tr><td style={S.td}>Send raw parts out for plating, or receive them back</td><td style={S.td}><b>Plating</b></td></tr>
                    <tr><td style={S.td}>Turn raw stock into phosphated /P stock</td><td style={S.td}><b>Convert</b></td></tr>
                    <tr><td style={S.td}>Cut an 8 ft rod down, or build a ring pack</td><td style={S.td}><b>Rod Cuts &amp; Ring Packs</b></td></tr>
                    <tr><td style={S.td}>Count a bin, or move stock between bins</td><td style={S.td}><b>Bin Count</b> / <b>Transfer</b></td></tr>
                    <tr><td style={S.td}>Find out where something is</td><td style={S.td}><b>Where is it?</b> in the header — a work order, a sales order or an item</td></tr>
                </tbody>
            </table>
        </div>

        <h2 style={S.h2}>One order, one pair of hands</h2>
        <p style={S.p}>When you start a pick, or press <b>Start packing</b>, the order becomes <b>yours</b>. Every
        other tablet sees a lock with your name and the time, and cannot start it. This exists because two people
        walking the rack for one order is how a box ships short.</p>
        <Screen title="Opening a card is looking, not taking" tag="you can always look">
            <p style={S.p}>Tap an order to <b>read</b> it — its lines, its quantities, where its parts are. Nothing is
            claimed and nothing changes. Only <b>Start packing</b> takes the order. <b>Close</b> leaves; if the order
            was yours it is released, and if you were only looking at someone else's it is untouched.</p>
            <p style={S.p}>Ticking a line or completing a pack on an order that is not yours is refused, and the
            screen says who has it.</p>
        </Screen>
        <Path name="A lock that will not go away" goes="an admin can release it, with a reason, which is recorded">
            A tablet that died mid-pick leaves the order locked. After four hours the card says so in red. Nothing
            releases on its own — an order is never quietly taken off the person holding it.
        </Path>

        <h2 style={S.h2}>SO Pack <span style={S.tabno}>(customer orders)</span></h2>
        <p style={S.p}>Every order for a customer, from either door: typed on Order Entry, or configured in CPQ.
        This is the <b>view</b> — the packing happens on Packaging Prep.</p>
        <Screen title="Four numbers, and the word that follows from them" tag="ordered · on hand · in production · committed">
            <p style={S.p}><b>Ordered</b> is what the customer asked for. <b>On hand</b> is <i>free</i> stock —
            what is on the shelf and promised to nobody; it already excludes anything another order has been
            promised. <b>In production</b> is what is being made or bought <i>for this order</i>. <b>Committed</b> is
            what is physically <i>gathered</i> for it, waiting in its bin.</p>
            <p style={S.p}>A card stays <b>closed</b> while the order is missing parts, and turns <b>green and opens
            </b> when everything is there. That is not decoration: an order missing parts is not work you can do, and
            a screen that showed it the same way as a ready one would send you to a shelf for a piece still at the
            plater. Use <b>▸</b> to open any card anyway and look.</p>
            <p style={S.p}>A line that reads <b>from the floor</b> is made to order. It arrives from finishing or from
            the plater — never pull it off a shelf.</p>
        </Screen>
        <Path name="Nothing on this order is committed" goes="check the sales order's LOCATION in NetSuite before you suspect the items">
            NetSuite commits stock per location. When a <i>whole</i> order reads uncommitted while the bins plainly
            have stock, the pattern is the diagnosis and it points at the order, not the parts.
        </Path>

        <h2 style={S.h2}>Committed bins — where an order's parts wait for each other</h2>
        <p style={S.p}>Some orders arrive in pieces over days: the small parts are on the shelf, the poles are at the
        plater. Rather than leave the early parts loose in stock, where the next order takes them, they wait together
        in a <b>committed bin</b> belonging to that order.</p>
        <Screen title="How a bin gets its order" tag="scan once, then follow it">
            <p style={S.p}>The <b>first</b> part gathered for an order asks you to scan a bin. Scan any <b>empty</b>
            committed bin — it becomes that order's until it ships, and from then on every other part for the order is
            sent to the same bin, so you are told rather than having to remember.</p>
            <p style={S.p}>A bin already holding another open order is <b>refused</b>, and the screen names the order
            in it. Gathering <i>more</i> than the order asked for is refused too — the surplus belongs to stock, or to
            another customer.</p>
        </Screen>
        <Path name="Some of it has to come back out" goes="Release, on the line, with a reason">
            An order is cancelled, or plated pieces come back short and part of the bin ships while part waits.
            Release takes a <b>quantity</b>, not just the whole bin, because part is the normal case. When the last
            piece leaves, the bin is free for another order.
        </Path>
        <Path name="NetSuite never hears about the committed bin" goes="it still shows the stock in its shelf bin, marked committed to the order">
            This is deliberate. The committed bin is the app's finer detail about <i>where the pieces physically are</i>
            and <i>whose they are</i>. NetSuite keeps the accounting.
        </Path>

        <h2 style={S.h2}>"20 arrived, 10 are for an order"</h2>
        <p style={S.p}>Small parts are usually bought or plated in <b>bulk for stock</b>, and the orders waiting on
        them are invisible at the dock. So when finished pieces are put away — on <b>Packaging Prep</b> for painted and
        stained work, on <b>Plating</b> for plated work — the screen asks whether any of them are spoken for.</p>
        <Screen title="The split" tag="oldest need first">
            <p style={S.p}>It lists which orders are short, how many each should take, and what is left for stock.
            Orders are served <b>oldest need first</b>, so a newer order cannot jump an older one just because its
            pallet happened to land today. Say <b>yes</b> and each order's share goes to its committed bin, asking for
            that bin once per order. Say <b>no</b> and it all goes to stock — which is recorded, along with how many
            were left outstanding, so the decision is on the books either way.</p>
            <p style={S.p}>Pieces plated <i>for</i> one order carry that order with them and skip this question
            entirely — they go straight to its bin.</p>
        </Screen>

        <h2 style={S.h2}>Plating <span style={S.tabno}>(out to the plater, and back)</span></h2>
        <p style={S.p}>Four steps, in order: a <b>demand</b> appears; you <b>pull</b> the raw stock to the plating
        bin; the weekly <b>shipment</b> goes out with a purchase order and a packing list; and the pallet comes
        <b> back</b>.</p>
        <Screen title="Receiving a pallet" tag="scan → cart → bin">
            <p style={S.p}><b>Scan to find.</b> One box at the top: scan or type either the raw code or the plated
            code, and that line jumps up and highlights. No reading down a wall of rows.</p>
            <p style={S.p}><b>Receive to a cart.</b> Enter how many good pieces came back and add them. Several carts
            per purchase order. <b>Save cart</b> closes one. Nothing reaches NetSuite at this step.</p>
            <p style={S.p}><b>Put away, which is what posts the build.</b> Open a saved cart, pick the line, scan the
            <b> bin</b>. One bin normally; <b>Multiple bins</b> for the rare split, where the quantities must add up.
            Only now does NetSuite hear anything.</p>
        </Screen>
        <Path name="Fewer came back than went out" goes="the difference is scrapped out of plating, once, with your name on it">
            Enter what actually arrived. The build and the return-to-stock cover the good pieces; the missing ones are
            adjusted out rather than left on the books forever.
        </Path>
        <Path name="Why the bin scan matters" goes="a plated assembly is bin-managed — a build with no bin is refused by NetSuite">
            The bin is not looked up, it is where you <i>put</i> them. That is why the build waits for the scan.
        </Path>

        <h2 style={S.h2}>Edges worth knowing</h2>
        <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
                <thead><tr><th style={S.th}>What you see</th><th style={S.th}>What it means</th></tr></thead>
                <tbody>
                    <tr><td style={S.td}>An order in the pending window, "still upstream"</td><td style={S.td}>The floor has not released its parts yet. You can pull one forward deliberately; it is recorded that you picked ahead.</td></tr>
                    <tr><td style={S.td}>Pack refused — custom parts not complete</td><td style={S.td}>The poles are still on the shop floor or at the plater. The box would ship short.</td></tr>
                    <tr><td style={S.td}>"At the plater"</td><td style={S.td}>Correct, and it clears itself when the pallet is received and put away on the Plating tab.</td></tr>
                    <tr><td style={S.td}>A bin the screen does not recognise</td><td style={S.td}>Scan the bin label rather than typing it. A bin NetSuite does not have makes the whole posting fail, and the stock would go missing on paper.</td></tr>
                    <tr><td style={S.td}>A put-away bin that looks like an item code</td><td style={S.td}>You scanned the item label instead of the bin. The screen refuses it.</td></tr>
                    <tr><td style={S.td}>A stale order nobody will ship</td><td style={S.td}><b>Close order</b> on its SO Pack card, with a reason. It also has to be closed in NetSuite, or its stock stays promised to it.</td></tr>
                </tbody>
            </table>
        </div>
        <p style={S.p}>Everything on these screens is in <b>English or Spanish</b> — the <b>EN / ES</b> buttons top
        left, remembered per tablet.</p>
    </div>
);

const SECTIONS = [
    { key: 'WO', label: 'Work Orders', comp: WorkOrdersGuide },
    { key: 'OC', label: 'Orders & Customers', comp: OrdersCustomersGuide },
    { key: 'SF', label: 'Shop Floor', comp: ShopFloorGuide },
    { key: 'WMS', label: 'Warehouse (WMS)', comp: WmsGuide },
    { key: 'RP', label: 'Rod Pieces', comp: RodPiecesGuide },
    { key: 'APP', label: 'Working on the App', comp: AppWorkGuide },
    { key: 'AU', label: '1.6 / 1.5 Authoring', comp: AuthoringGuide },
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
