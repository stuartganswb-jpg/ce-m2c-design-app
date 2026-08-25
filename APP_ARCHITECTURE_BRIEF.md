# CE / M2C — General App Improvement Brief

*Written 2026-08-25, from a week of fixing production bugs in HQ, WMS, Finishing and the sync layer.
Intended as the orientation document for general improvement work: what the system is, how the parts
join, and — the part that actually matters — the small number of recurring mistakes that produce most
of the bugs Eric, Grace, Sandra and Andrea report.*

**Confidence note.** I have direct, recent exposure to HQ (Stock View, RTG, NetSuite Sync, Master
Library, BOM), WMS Pick/Pack, the Finishing floor, and the shared modules. My exposure to Shop Floor,
CPQ internals and the Portal is thinner — those sections are marked, and should be checked before
being relied on.

---

## 1. What this is

A React + Firebase PLM/WMS for two brands (Classical Elements, M2C Studio; plus Uniquity and Leyla),
live at **4cosworkcenter.com**, with NetSuite as the system of record for inventory and financials.

Five front-ends over one Firestore database:

| Surface | Who uses it | Lives in |
|---|---|---|
| **HQ** | office — catalogue, quoting, purchasing, dispatch | `src/components/HQ/` |
| **Finishing** | Grace's floor — setup queue, active floor, recipes | `src/components/FinishingFloor/` |
| **Shop** | custom fabrication | `src/components/ShopFloor/` |
| **WMS** | Sandra/Andrea — pick, pack, count, convert, rod cuts | `src/components/PickPack/` |
| **Portal** | customers — `portal.classicalelements.com` | separate slim frontend + `functions/portalEngine.js` |

Plus `src/components/Shared/` — the modules more than one surface depends on. **That directory is the
most important thing in the repo.** Nearly every bug this week was a rule that existed in `Shared/`
and was re-implemented, slightly differently, somewhere else.

---

## 2. How an order actually flows

Two streams, and they behave differently. Knowing which one you're looking at explains most confusion.

### Custom (a customer order)
```
CPQ / Portal  →  quote  →  hq_sales_orders  →  RTG Dispatch  →  release
                                                     ├→ fin_workorders   (finishing)
                                                     └→ shop_custom_orders (fabrication)
                                              →  WMS pick  →  staging handshake  →  pack  →  ship
```

### Stock (replenishment)
```
Stock View grid  ─┐
Stocked Sales    ─┼→  hq_work_orders  →  RTG Dispatch  →  release  →  fin_workorders  →  pack → put-away
Master Library   ─┘                                   └→  NetSuite work order (Route A)
```

**RTG Dispatch is the gate.** Nothing reaches a floor without passing through it. That is deliberate
and worth protecting: it is the one place a human confirms before work is released.

**RTG is also the single source of truth for order lifecycle.** `Shared/orderLifecycle.js` is the one
closer — `closeOrderEverywhere` reaches finishing, shop, WMS and NetSuite together, and `auditOrphans`
finds orders still open on a floor after the board closed them. Anything that closes, cancels or
completes an order should go through it rather than setting a status locally.

---

## 3. The single-point-of-truth register

When you need one of these answers, import the module. Do not re-derive it.

| Question | The one answer | Notes |
|---|---|---|
| Is this a pole? | `Shared/poleCut.js` → `isPoleCategory(productType)` | **Category only** (`POLE`/`ROD`). Never `finishStream`, never the code grammar |
| How is it finished? | `manufacturingSpecs.finishStream`, defaulting via `autoFinishStream()` | The *recipe variant* (-S/-P). Different question from the above |
| What does this order build? | `Shared/finishedGoodsRun.js` → `planFinishedRun()` | Handles both product models — see §5 |
| What item is this order for? | `Shared/workOrderContract.js` → `woItemCodeOf(wo)` | See §4 — this exists because we got it wrong |
| Can this step start? | `Shared/orderStatus.js` → `pickGateOf(wo)` | No finishing starts while the pick is open |
| Close / cancel an order | `Shared/orderLifecycle.js` → `closeOrderEverywhere` | The only closer |
| Scrap arithmetic | `Shared/scrapClose.js` → `planBalanceClose()` | Good / bad / salvageable → everything derives |
| Cut a rod | `Shared/poleCut.js` → `planManualCut()` | Pole/rod + in library + has NetSuite id |
| Tag vocabulary | `Shared/assemblyTags.js` | The locked vocabulary for hardware assemblies |
| Finish routing (`/P` vs plater) | `Shared/finishRouting.js` | `/P`, `/P01…`, `/P25` are three different things |
| Brand → NetSuite sub/loc | `BRAND_NETSUITE_MAP` | ⚠ **duplicated in 4 files** — keep in sync, or better, extract it |

---

## 4. The failure mode that produces most bugs

**The same fact stored under different names in different modules, then read with a test that only
knows some of them.**

This is not a theoretical concern. Three separate production bugs this week, all the same shape:

### The item code — written seven ways
`woItemCodeOf` has to check seven fields to answer "what item is this work order for?":

```js
[wo.jfpItemCode, wo.stockErpId, wo.variantErpId, wo.partErpId, wo.rootItem, wo.erpId, wo.type]
```

Each writer chose its own field. Eric's 8/25 report — *"orders from Stocked Sales do not show the item
information"* — was the Sales Snapshot writing `erpId` while the resolver read the other six. The card
went blank on exactly the orders the feature was built for.

### "Is it a pole?" — asked four ways
Four tests, four answers. Only one knew about **rods**:

| where | test | a ROD? |
|---|---|---|
| rod cuts | `\b(POLES?\|RODS?)\b` | ✅ |
| Stock View | `POLE\|ROD` | ✅ |
| Setup Queue | `.includes('POLE')` | ❌ |
| NetSuite sync | `'pole'` or `'track'` or UOM ft | ❌ |

Grace's WO11485/11486 — *"treating them as small parts and not poles. These are 4ft rods"* — was the
Setup Queue's spelling. Her items were tagged correctly the whole time.

### The rod cut — gated on a code pattern instead of the item
The ✂ appeared only where the code read as exactly 8 ft, and derived the cut-down item by string
substitution. Rods spelled another way had no cut tool at all, and `HTA1235` couldn't even be read as
12 ft. Eric's *"there is no Cut icon"* was the tool refusing to appear.

### The rule
> **Ask what the item IS, not what its code looks like. Ask once, in `Shared/`, and import it.**

Before adding a field to a document, search for what already holds that fact. Before writing a test
like `productType.includes(...)` or a regex over an item code, check whether `Shared/` already answers
it. If you must add a synonym, teach the shared resolver about it in the same commit.

---

## 5. Two product models — get this right before touching BOM code

The divisions stock differently, and code that doesn't know which one it's looking at will corrupt one
of them. `planFinishedRun` tells them apart by **does this item have BOM pins**:

**Model A — stocked finished assemblies.** Brimar/legacy (`HCUMLB415/CP` and its SG/BL siblings) and
the whole H2 Simple Elegance collection. The finished code **is** a NetSuite assembly, so it has pins.
→ **Take the BOM literally. Pull exactly what it names.** Some of these bill a phosphated component,
some bill the bare base and are painted straight over it. Both are correct; the BOM says which.
Rationale: NetSuite's assembly build consumes those component lines, so picking a different code than
the build consumes is how the app and NetSuite start disagreeing about what left the shelf.

**Model B — custom division.** Stocked only as mill (`H1-138BE`) and phosphate (`H1-138BE/P`). The
finished code is not a stocked assembly and has no pins. → The `mill + '/P'` substitution **is** the
routing: mill → phosphate → apply finish. Plater runs take the mill core.

Until 2026-08-25 the `/P` substitution ran on Model A components too. It was harmless only because no
Brimar component happened to have a `/P` record — an accident of the data, not a rule.

---

## 6. Data-model gotchas

**`partsList` is a photograph, not a link.** A work order's BOM is frozen when the order is raised and
never re-reads the item master. So fixing an item does **not** fix orders already cut from it. Any
data repair needs two halves: fix the source, *and* repair open orders. RTG's `↻ BOM` and the 11.1
force-fix buttons exist for the second half.

**App Check blocks all local/Node access to production Firestore.** No script on your machine can read
or write live data — it returns permission-denied. Bulk data changes must be done **inside the
authenticated app**, which is why data fixes ship as admin buttons. Design them with a **dry run** that
reports and writes nothing; the dry pass is where you find out the rule is too broad.

**NetSuite constraints that have bitten us:**
- SuiteQL returns **1000 rows per page**. Anything reading a list must paginate (keyset: `id > lastId
  ORDER BY id`). Andrea's bin bug was one un-paginated page treated as the whole warehouse.
- A **non-WIP work order cannot be closed** via `!transform/workorderclose`. Ours are created non-WIP.
  Still unresolved — see §10.
- Bin transfers need a line-level `quantity` plus a top-level `subsidiary`; OAuth signing must
  percent-encode `!`.
- An inventory adjustment **line** must be single-direction (all + or all −), or mixed bins are rejected.
- Some columns simply don't exist on this account (`ItemVendor.vendor`, `ItemVendor.purchaseprice`,
  `item.salesdescription`). SuiteQL fails the *whole query* on one bad column — hence `probeColumns`.

**A validator may only refuse on complete knowledge.** If the list it checks against may be truncated,
unreachable or empty, it must warn rather than block. Refusing on partial data is worse than not
checking: the operator can see the thing is real, so the app just looks broken and gets worked around —
spending exactly the trust the check was bought with.

---

## 7. Deploy

### Frontend — Vercel, automatic
Push to `main` → production. After deploy the user must **hard-refresh (⌘⇧R)**.

```bash
rm -f .git/index.lock
git add <specific files>          # never -A: other sessions work this repo
git commit -q -m "..."
git pull --rebase --autostash origin main
git push origin main
```

**Multi-session rule:** never `git checkout` another branch in this checkout — it races other sessions'
in-flight files and has landed a commit on main unintentionally. Commit small changes directly on main;
use `git worktree` for bigger multi-commit work.

**The stale-build trap.** A deploy can report "Ready" with the right commit hash and a fresh
`version.json` and still serve **old code** — Vercel compiling a stale checkout. No push fixes it.
Fix: Vercel dashboard → Deployments → ⋯ → **Redeploy with "Use existing Build Cache" UNCHECKED**.

Before debugging a shipped change that "does nothing", grep the live bundle for a marker string:
```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```
⚠ **The app is code-split.** Lazy-loaded tab code (Library, Quick Ship, Admin, CRM…) never appears in
`main.*.js` — a marker grep there reads as "stale" when prod is current. For tab code, extract *every*
chunk map from the main bundle (there are several — sweeping only the first has false-negatived before)
and grep the chunk files. Use plain-ASCII markers; non-ASCII may be unicode-escaped.

### Functions — manual, via Cloud Shell
`functions/index.js` (NetSuite OAuth proxy, PIN auth, portal endpoints). **Vercel does not deploy
functions.** Local `firebase login` fails on this Mac (localhost callback), so deploy from
[shell.cloud.google.com](https://shell.cloud.google.com):

```bash
git pull
firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab
```

A functions change that isn't deployed looks exactly like a frontend bug. If behaviour doesn't match
the code, check whether the function was ever pushed.

---

## 8. Site settings & configuration

Config lives in Firestore, not in code. Knowing where to look saves a lot of guessing.

**`system/*` — global rules and vocabularies**

`master_finishes` · `master_lists` · `master_schema` · `cpq_rules` · `bracket_span_map` ·
`finish_run_days` · `plating_fees` · `crm_discounts` · `netsuite_sync_flags` · `retired_items` ·
`spec_sheet_config` · `traverse_rules_H1` · `window_config` · `app_feedback` · `salesCache_<brand>_<ym>`

**Per-surface config + permissions:** `hq_config`, `fin_config`, `pick_config`, `shop_config` — each
with its own `permissions` doc. Roles are per-app, which is why "manager or above" needed mapping onto
`superadmin / admin / executive` in HQ (there is no HQ "manager" role).

**Users:** `hq_users` (login + permissions, via `authenticatePin`) and `fin_users` (legacy finishing,
chip PINs). Two directories, one import button between them.

**Super admin trap:** super admin can reach tabs but was historically excluded from inner
`['admin','programmer']` gates. When you add a role gate, include it.

**Main data collections** (by usage): `Approved_Designs` (the master library — every item and
assembly), `assembly_pins` (BOM lines), `hq_work_orders`, `fin_workorders`, `shop_custom_orders`,
`hq_sales_orders`, `hq_purchase_orders`, `crm_records`, `cpq_flows`, `rod_cut_orders`, `convert_demand`,
`ns_outbox`, `global_messages`, `hq_logs` / `fin_logs` / `shop_logs`.

---

## 9. Portal *(lower confidence — verify before relying on this)*

`portal.classicalelements.com` is a **separate slim frontend**. Customers authenticate with Firebase
Auth; every read goes through Cloud Functions (`functions/portalEngine.js`, `portalRequestLines.js`,
`aliasIdentity.js`, `feeRulesPort.js`) which shape sanitized payloads **server-side** — no costs, no
vendor data, no other customers, no internal notes. Staff manage portal users from the CRM;
`portal_users` holds the logins.

**The structural risk:** the portal *mirrors* CPQ logic rather than sharing it. Data flows
automatically; **logic and schema do not**. Every CPQ rule change needs a deliberate mirror-sweep, or
the portal quietly diverges. The whitelist approach is leak-safe by design — a field not explicitly
allowed simply doesn't cross — so divergence shows up as *missing*, not as *wrong*, which is the safer
failure but still a failure.

`CROSS_SESSION_CONTRACT.md` maps territory and deploy responsibilities when several people work these
areas at once.

---

## 10. Where I'd start

**Structural, highest leverage:**
1. **Extract `BRAND_NETSUITE_MAP`** into `Shared/`. Four copies of the subsidiary/location map is a
   silent-divergence bug waiting to happen; it costs an hour.
2. **A canonical order-identity module.** Seven fields for one item code is the root of a whole family
   of "the card is blank" reports. Write once, migrate writers, keep `woItemCodeOf` as the safety net.
3. **Audit every `productType` / item-code regex** against `Shared/` equivalents. The pole bug proved
   there are more of these than anyone thinks.
4. **A "repair open orders" pattern.** Every data fix needs one; today each is hand-rolled.

**Known open, needs someone else's answer:**
5. **NetSuite WO close** — non-WIP orders refuse `workorderclose`. Needs Eric to choose: PATCH status
   directly / create WOs as WIP / close by hand and stop pretending. **This blocks the scrap flow**,
   since every scenario starts with "close the balance".
6. **`ItemVendor.vendor` column name** — the PO vendor-id fix has never had data behind it because the
   column doesn't exist on this account. Needs the real column name from Eric.
7. **Sales sync cadence** — Eric asked for *weekly, Sunday*; what shipped caches *per month*. Close,
   but not what he asked.

**Worth doing while you're in there:** run the 11.1 **Force Pole / Rod Tags** dry pass and read the
list before applying — the category test matches the word, so a category like "ROD SOCKET" would be
swept in.

---

## 11. Working rules that have earned their place

- **Ask what the item IS, not what its code looks like.**
- **One rule, one module, imported everywhere.** A second implementation is a future bug with a date on it.
- **Refuse on certainty; warn on doubt.** Never block someone who is right.
- **Never manufacture data to make a write succeed** — a mistyped bin must be rejected, never created.
- **An unrecorded write is worse than a refused one.** If a NetSuite id can't be resolved, skip that
  step and *name it* rather than guessing.
- **Fix the source and repair the orders.** One without the other looks like the fix didn't work.
- **Dry run first** on anything that touches data in bulk.
- **Test the cases that must NOT change**, not just the one you're fixing. That's what catches the
  regression you didn't think of.
