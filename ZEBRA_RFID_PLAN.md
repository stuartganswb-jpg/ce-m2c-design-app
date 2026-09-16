# Zebra RFID Plan — chokepoint job-tracking (2026-09-09)

Goal (Stuart): fixed RFID read points at key transitions to confirm jobs move correctly through
the building and catch anything moving wrong. Building: 400ft × 100ft; shop floor = back LOWER
level; finishing = back main; warehouse = middle main; shipping/receiving = front main.
Researched live on zebra.com + spec sheets/reseller pricing (street prices ≈25-30% under list).

## 1. The five chokepoints (fixed readers — the core buy)

| # | Transition | What it catches | Hardware |
|---|---|---|---|
| 1 | Shop (lower) → Finishing (stair/freight lift) | milled parts arriving at finishing; anything leaving shop that shouldn't | Transition/Wall-Mount RFID Portal (PoE, all-in-one) or FXR90 w/ integrated antenna |
| 2 | Finishing → Warehouse threshold | finished goods entering stock; unfinished sneaking forward | same |
| 3 | Warehouse → Shipping/staging | picks leaving stock; wrong-order pulls | same |
| 4 | Dock door(s), front | outbound cartons vs the fulfillment (wrong-box-on-truck catch); receiving | FXR90 8-port (~$2.3k) + 2–4 AN480 antennas (~$100–200 ea) per door |
| 5 | Plating/outsource out-door (wherever vendor shipments leave) | WOs leaving to plating vendor + coming back — closes the plating loop | portal or share reader #1/#4 if same door |

- Chokepoints are far apart in a 400ft building → each needs its own reader (PoE run to each);
  antenna-sharing off one reader only pays at the dock where doors sit together.
- **FXR90** is the current go-forward fixed platform (4/8-port, ~$1.8–2.3k street, integrated-
  antenna option ~$2.2k, reads to ~100ft — power gets TUNED DOWN so a doorway doesn't hear the
  aisle 30ft away in a 100ft-wide building). FX9600/FX7500 still sold but older-gen — don't buy
  new. **Integrated Portals** (Transition / Wall-Mount) = reader+antennas pre-assembled, one PoE
  cable, no RF engineering — price via partner; likely worth it for doorways 1–3.
- **ATR7000** overhead RTLS (~$3.8k/unit + grid + CLAS software): real-time x/y to ~2ft —
  overkill for zone confirmation; revisit only if we later want live WIP maps.

## 2. Handhelds + stations

- **RFD40 Premium sled** (~$1.3k) or **RFD90** rugged (~$1.9–2.1k, 40–95ft) — cycle counts,
  Geiger-counter "find this order" mode. Pairs with TC-series Android (WMS web app runs in the
  browser; sled data reaches it via DataWedge keystroke/intent — plan a config, not custom code).
  **MC3390xR** (~$4.2k) = gun-style all-in-one alternative (Android, 60ft) if pairing annoys.
- **DS9908R** (~$1.2k) hands-free presentation reader at the PACK station — verifies carton tag
  ↔ order at pack, doubles as barcode scanner. (TC53e-RFID ~$3.7k exists; short-range.)
- Shop floor near heavy metal: if RFID proves noisy there, the barcode fallback is the DS3678
  rugged scanner (~$0.7–1k) — chokepoint #1's portal still catches the movement.

## 3. Tags & printers — the metal + paint-oven realities

- **Metal kills standard RFID labels.** For anything stuck to steel/brass/racks/carts:
  **Silverline on-metal family** (sold by Zebra, IP68, solvent-resistant): Blade II 33ft/$~1.04,
  Slim II 23ft (rod/pole shaped), Micro II 12ft/$~0.59 (bracket/finial scale).
- **Heat limit: Silverline survives only 110°C for 10 min** → tags CANNOT ride through the
  finishing oven. Tag the CARRIER, not the part: reusable Silverline on carts/racks/WO traveler
  boards through finishing (bind cart↔WO in the app), or Confidex **Heatwave** hard tags (made
  for paint lines) if a tag must ride the part — availability via partner, not verified in
  Zebra's own catalog.
- **Cartons/bins/paper**: standard Zebra RFID labels (ZBR2000/ZBR4000 inlays, ~17–20m free
  space) printed in-house. Metal contents inside a box degrade reads — use flag-style labels
  and TEST with samples (Zebra ZipShip samples ship in 24h).
- **Printers**: **ZD621R** desktop 4" RFID printer-encoder (~$2.5–5k street) at pack — encodes
  carton labels AND prints the existing 4×6 stock (RFID labels only where wanted). ZD611R is
  the 2" variant if we want RFID bin/2×4 labels later. On-metal tags are NOT printable on these
  — buy Silverline PRE-encoded (cheap per tag) instead of the special ZT411R on-metal printer
  until volume justifies it.

## 4. App integration (our side — all standard patterns)

- Every current fixed reader/portal runs **Zebra IoT Connector**: POSTs tag reads as JSON over
  HTTP/MQTT to any endpoint, no Zebra cloud required. → one new `onRequest` Cloud Function
  (`rfidIngest`, shared-secret header, same shape as the webhook receiver planned for NMI):
  tagId+readerId+timestamp → map tag→`orderKey`/`hq_work_orders`/carton → stamp zone movement.
- Wrong-move detection = compare reader zone vs the order's expected next station from the
  existing routing/status model (orderStatus/finishRouting); surface breaches on RTG board +
  floor tabs (they already show status; this adds "seen at" + alerts).
- Tag binding: carton labels encoded at print (EPC = orderKey-derived); cart/rack tags are
  fixed assets bound to a WO by a scan at load (sled or DS9908R).
- Handheld→web app = DataWedge into the existing scan-match flows (no new stack).

## 5. Suggested pilot (before spending the subsidy)

1 portal (or FXR90-integrated) at the warehouse→shipping door + 1 RFD40+TC + 1 ZD621R +
Silverline sample pack + carton label rolls ≈ **$6–8k street before subsidy**. Prove: carton
reads through the door, cart tracking, ingest→RTG stamping. Then roll the other four points
(full build ≈ $15–20k hardware before subsidy/trade-in).

## 6. For the Zebra rep

- Price the **Integrated Transition/Wall-Mount Portals** vs FXR90 per-door (portals had no
  public price).
- **GO Zebra trade-in is active for 2026**: $50–650/device rebate, any-brand trade-ins, applies
  to RFID devices — stack it with the subsidy they're offering.
- Ask for **Silverline + ZipShip label samples** and their inlay-test service (free RF testing
  of our cartons/parts), and the Heatwave hard-tag channel for through-oven tagging.
- Give them the finishing-oven temp profile + solvent list for tag selection.
- Confirm FX9600/FX7500 end-of-life posture in writing if anyone quotes them cheap.

Open items: portal pricing; oven temp profile; whether truly-small brass parts get tagged at
all (traveler-level is fine); Wi-Fi vs PoE drops at the two back chokepoints.
