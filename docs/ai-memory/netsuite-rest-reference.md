---
name: netsuite-rest-reference
description: "Confirmed-working NetSuite REST/SuiteQL settings: proxy, account/subsidiary/location/status/account IDs, key item & vendor IDs, and the exact payload shapes that POST successfully (adjustment, bin, bintransfer, assemblybuild, PO, itemreceipt)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 51fa5a68-4c5f-4589-bd80-48db20ff7e21
---

Authoritative, battle-tested NetSuite integration facts (confirmed live through the finishing/plating + CPQ work, 2026-06). Use these instead of rediscovering. Cross-ref [[netsuite-app-master]] (App-as-master/push project) and [[finishing-conversion-wip]] (the plating flow that proved most of these).

## Proxy & endpoints
- Cloud proxy (OAuth-signed server-side): `https://netsuiteproxy-f3h3jadzaq-uc.a.run.app`. POST body `{ targetUrl, method, payload }`. Pure pass-through → NetSuite rejects the WHOLE record on any bad/unknown field (no per-field tolerance).
- REST base: `https://3728153.suitetalk.api.netsuite.com/services/rest/`
- SuiteQL: `…/query/v1/suiteql`, method POST, payload `{ q }`. Records: `…/record/v1/{type}`. Transform: `…/record/v1/{type}/{id}/!transform/{newtype}`.
- **GOLDEN RULE: every `{id}` in a payload (entity/item/account/subsidiary/location/customForm/status) is the NetSuite INTERNAL id — NEVER the entityid / itemid / document number.** Sending a number/name where an internal id is expected throws a *misleading downstream* error (e.g. wrong vendor entityid 83361 → "Invalid Field Value 2 for subsidiary"). When a write 400s on a field that looks correct, SuiteQL-verify every id resolves before changing anything.
- Record POSTs return **204 No Content with the new internal id ONLY in the `Location` response header** (the proxy does NOT forward it → `result.id` is usually null). Recover the id via SuiteQL by a unique memo, e.g. `SELECT id, tranid FROM transaction WHERE type='PurchOrd' AND UPPER(memo) LIKE '%{shipId}%'`. (`Prefer: return=representation` is set by the proxy on `/record/` POSTs but NetSuite doesn't honor it for POs.)

## Confirmed IDs
- **Subsidiaries**: 1=Classical Elements Consolidated (parent), **2=Classical Elements LLC (CE)**, **3=M2C Studio**, 4=Elimination, **5=Leyla Gans**, **6=Unique/uniquity**, 7=Mill Yard.
- **BRAND_NETSUITE_MAP** (sub, location — used in PickPackApp + ERPPushPullTab): `ce={2,17}`, `m2c={3,19}`, `leyla={5,18}`, `uniquity={6,22}`.
- **Locations** (id → name, subsidiary): 17=High Point - CE (2), 18=High Point - LG (5), 19=High Point - M2C (3), 22=VERELLEN-DENVER CO (3). (Confirmed via `SELECT id,name,subsidiary FROM location`.)
- **Inventory Adjustment account** = **254**.
- **Inventory statuses**: Good (available) = **1**; WIP-Plating (non-available) = **13**.
- **Dayton Grey** plater vendor: INTERNAL id **42036** (entityid/vendor# = 83361 — do NOT use 83361 in payloads), subsidiary 2.
- **"Weekly Plating Shipment"** Service-for-Resale item: **61947** (already an internal id).
- **customForm**: "LG - Purchase Order Form" = **272** (required for POs via this role); "LG - Quote/Estimate" = 256.
- Phosphate assembly `H1-138EC/P` internal id = **56771** (lot-numbered). Plated assemblies `H1-138EC/EP1..EP6` exist (Assembly, **bin-managed, NOT lot-numbered**; raw is the BOM component). Finish-code prefix encodes brand: **EP*/P → CE (sub 2)**, **MEP* → M2C (sub 3)**.
- CPQ rollup default non-inventory item = **61502** (per-flow override `flow.nsRollupItemId`).
- NS custom-field ids (write-back): basePrice=`custitem9`, product_type=`custitem_bit_product_type`, collection=`custitem_bit_itemcollection`, watchlist=`custitem_bit_watchlist`, projection=`custitem_bracket_projection`, sync-to-CPQ flag=`custitem_sync_to_cpq`; SO/estimate line projection col = `custcol_bracket_projection`, part category col = `custcol_part_category`; quote#=`custbody50`.

## Working payload shapes (all CONFIRMED to POST, except where noted)
- **Inventory adjustment** (cycle count + status-aware moves) — `record/v1/inventoryadjustment`:
  `{ account:{id:"254"}, subsidiary:{id:SUB}, memo, inventory:{ items:[ { item:{id:ITEM}, location:{id:LOC}, adjustQtyBy:DELTA, inventoryDetail:{ quantity:DELTA, inventoryAssignment:{ items:[{ binNumber:{refName:"BIN"}, inventoryStatus:{id:STATUS}, quantity:DELTA }] } } } ] } }`. The sublist is `inventory` (NOT `inventoryList`); location is a LINE field; bin by **refName** (the bin number string, uppercased); the detail qty + the bin-assignment qty are the SAME signed delta. For a Good↔WIP status move, send TWO offsetting lines (−qty out of status A @ binA, +qty into status B @ binB). There is NO `inventorystatuschange` record in REST (404).
- **Create bin** (idempotent) — `record/v1/bin`: `{ binNumber:"BIN", location:{id:LOC} }` (uppercase; swallow duplicate-exists error as success).
- **Bin transfer** — `record/v1/bintransfer`: `{ location:{id:LOC}, memo, inventory:{ items:[{ item:{id:ITEM}, inventoryDetail:{ quantity:Q, inventoryAssignment:{ items:[{ binNumber:{refName:FROM}, toBinNumber:{refName:TO}, quantity:Q }] } } }] } }`.
- **Assembly build** — `record/v1/assemblybuild`: `{ item:{id:ASSEMBLY_INTERNAL_ID}, subsidiary:{id:SUB}, quantity:Q, location:{id:LOC}, memo }`. Components AUTO-CONSUME from the BOM (do NOT send a component sublist). Lot-numbered assembly → add `inventoryDetail:{ quantity:Q, inventoryAssignment:{ items:[{ receiptInventoryNumber:"LOT", quantity:Q }] } }`. Bin-managed assembly → same `inventoryDetail` but with `binNumber:{refName:BIN}` instead of (or alongside) the lot. Resolve the assembly id + verify type via `SELECT id,itemtype FROM item WHERE UPPER(itemid)='…'` (must be an Assembly).
- **Purchase Order** — `record/v1/purchaseorder`: `{ customForm:{id:"272"}, entity:{id:VENDOR_INTERNAL_ID}, location:{id:LOC}, memo, item:{ items:[{ item:{id:ITEM}, quantity, rate, description }] } }`. Subsidiary DERIVES from the resolved vendor — do NOT set `subsidiary` (setting it is rejected). Put line text in the item line `description` (CPQ-style reference). CONFIRMED: posted PO2179 (Dayton Grey 42036, CE sub 2, loc 17).
- **Item receipt** (receive a PO) — `record/v1/purchaseorder/{poInternalId}/!transform/itemreceipt`, payload `{ memo }`. ⚠️ UNTESTED; if the `!transform` path misbehaves, fallback is POST `record/v1/itemreceipt` with `createdFrom:{id:poId}`.
- **Estimate** (CPQ push) — `record/v1/estimate`: `{ entity:{id:CUST_INTERNAL_ID}, subsidiary:{id:SUB}, location:{id:LOC}, memo, custbody50:quote#, item:{ items:[ {rollup line}, …{ item:{id:NS_ID}, quantity, rate, price:{id:"-1"}, description, custcol_part_category } ] } }`. Customer id from `crm_records` doc id `CUST-{nsId}` (strip `CUST-`); vendor likewise `VEND-{nsId}`.

## SuiteQL gotchas
- There is **no `subsidiary` table** (400 "Record 'subsidiary' was not found"). Read a subsidiary via the `location` table's `subsidiary` column, or off the vendor/item row.
- Vendor: `SELECT id, entityid, companyname, subsidiary FROM vendor WHERE UPPER(companyname) LIKE '%DAYTON%'` (NOT by entityid as `id`). Item: `FROM item WHERE id=…` or `WHERE UPPER(itemid)='…'`. PO/transactions: `FROM transaction WHERE type='PurchOrd'`. On-hand: `AggregateItemLocation.quantityonhand` joined to `Item`.
