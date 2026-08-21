# Portal on the new engine — session brief

Paste this into a fresh session. Written to be read cold. Read
`CROSS_SESSION_CONTRACT.md` first — the portal is Session A's territory and the rules there win.

## The situation

HQ's CPQ now runs on the TAG-DRIVEN engine for Classical, and it is open to every user on every
brand (`CPQTab.js` → `newEngine` / `engineOn`). The portal still runs the OLD one:
`portal/src/Configurator.jsx` walks `flow.steps` and keys everything on `dynamicConfigParams`
(step id → optId), and `functions/portalEngine.js` prices by walking those same steps.

That is not a bug yet — the old engine still exists and still drives lighting and pillow flows —
but the two configurators now answer the same question by different means, and the contract this
project runs on is that **a number shown in two places comes from ONE place**. Every fix landed in
the tag engine since 2026-08-17 (plate pools, bracket counts, per-part finishes, per-line finish on
the BOM, the traverse end settled by the drive, rings-vs-carriers, the H2 combined flow) is
invisible to the portal.

## What the tag engine is

Four pure, node-tested modules under `src/components/Shared/`:

| Module | What it does | Tests |
|---|---|---|
| `hardwareAdapter.js` | one pin + its cluster → one tagged CHOICE | `scripts/hardwareAdapter.test.mjs` |
| `hardwareModel.js` | choices + answers → axes, slots, riders, BOM, visible nodes | `scripts/hardwareModel.test.mjs` (582) |
| `hardwarePricing.js` | a resolved configuration → priced lines | `scripts/hardwarePricing.test.mjs` |
| `hardwareHandoff.js` | a resolved configuration → the cart item every consumer reads | `scripts/hardwareHandoff.test.mjs` |

They import nothing from React and nothing from Firebase. That is deliberate and it is what makes
this port tractable: the portal can run the SAME model, not a mirror of it.

`HardwareConfigurator.js` is the React shell around them — steps, rail, finish panel, quote panel.
The portal needs its own shell (different audience, different chrome), not a copy of that file.

## The work, in the order I would do it

1. **Get pins to the portal safely.** The portal is a BFF with a whitelist; it must not gain raw
   Firestore reads. Extend `functions/portalEngine.js` to return the assembly's `assembly_pins` +
   `nodeClusters` for a flow the customer is entitled to — the same entitlement gate the current
   endpoint uses. Send the tags the model reads and nothing else (no cost fields, no internal notes).
2. **Mirror the four modules** into `portal/src/shared/` the way `sizeMatrix.js` and
   `bracketSpan.js` already are. They are pure ES modules; copy, do not fork. If a copy has to
   diverge, that is a signal the HQ module needs a parameter instead.
3. **Price on the server, not the client.** `portalEngine.js` already resolves a customer's
   `clientPricing`. Keep that: the portal shell should render what the server priced, so a customer
   can never see a cost basis. `hardwarePricing.priceConfiguration` runs fine in Node.
4. **Build the portal shell** — the customer's walk. It does NOT need the finish rail's per-part
   exceptions, the diagnostics, the extras editor, or the tag notes. It needs: the size questions,
   the world axes, the slots in order, the length, rings/carriers, and traverse components.
5. **Checkout parity.** `portal/src/Checkout.jsx` → `portalStockQuoteRequest` → jobs
   `PORTAL_REQUEST`. The cart item shape must be `handoffItem`'s, so a portal quote reopens in HQ's
   CPQ exactly like a staff one.

## Traps that will cost you a day if nobody says them

- **`resolve()` normalizes what it is given, and normalizing an already-normalized choice drops
  `proj`.** Pass RAW choices from the adapter. This cost a test that reported every bracket as
  untagged.
- **Projection lives in the PIN's `projInches` tag**, not the library item's
  `customData.projection`. As of 2026-08-21 Vision reads the tag too. Do not reintroduce the
  second field.
- **A const is not hoisted.** A hook whose dependency array names something declared further down
  throws "Cannot access X before initialization" and takes the whole engine out. It happened once
  in HQ and the app was down until it was found.
- **Unpriced parts.** The chain is pin override → price level → the customer's row → base price →
  the flow's per-kind fallback (`fallbackPrices`, set in tab 11). A fallback line is flagged amber
  and must NEVER be presented to a customer as a firm price without staff review.
- **Leak safety.** The whitelist exists because a portal payload once carried more than it should.
  Every new field added to the portal's endpoint is a decision, not a convenience.

## Definition of done

A customer configuring H1-138 in the portal and a staff member configuring the same thing in HQ
produce the same part numbers, the same quantities and the same total — and the portal's quote
request reopens in HQ's CPQ with every answer intact.
