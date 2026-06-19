---
name: label-printing
description: PickPack device-aware label printing — PC browser landscape print vs tablet ZPL autoprint; Code128 SVG; localStorage override; tablet autoprint still a STUB
metadata: 
  node_type: memory
  type: project
  originSessionId: 51fa5a68-4c5f-4589-bd80-48db20ff7e21
---

PickPack labels are device-aware (SHIPPED to prod 2026-06-18, `main 5d3f85d`). Module-level helpers in `src/components/PickPack/PickPackApp.js` (above the component): `detectPrintMode()`, `code128BSvg()`, `printHtmlLabel()`, `emitLabel(zpl, htmlSpec)`. The two plating labels (`printPlatingLabel` Phase 2 WIP, `printShipmentLabel` Phase 3 pallet) build their ZPL as before but now call `emitLabel(zpl, {title,widthIn,heightIn,html})`.

- **PC** (`detectPrintMode()==='pc'`, the default/unknown): `printHtmlLabel` renders the 2x4 label as a **landscape 4in×2in** HTML page (`@page{size:4in 2in}`) in a hidden iframe (pop-up-blocker-safe, prints only the label) and calls `print()` → the browser dialog opens, honoring **whatever printer settings the PC already has** (per user: don't force a printer). Includes a real **Code 128-B barcode generated inline as SVG** (no new dep — `CODE128B` is the 107-pattern table, validated; encoder = Start B 104 + checksum%103 + Stop 106, bars at even module index, `preserveAspectRatio="none"` so width:100% stretches uniformly + stays scannable).
- **Tablet** (iPad incl. iPadOS-as-Mac+touch, Android non-Mobile, etc.): keeps the ZPL path — **but autoprint is still a STUB** (`console.log` the ZPL). ⏳ TODO when user is ready: wire real ZPL autoprint (Zebra BrowserPrint SDK or a local print bridge) in `emitLabel`'s tablet branch. User said "we can set up that in just a bit."
- **Override**: a station can pin its mode with `localStorage 'labelPrintMode' = 'pc' | 'tablet'` if detection guesses wrong.

NOT yet routed through `emitLabel`: the staging `printZebraLabel(job,type)` (still a `console.log` orderKey stub — different label, back-half Phase 2). Wire it the same way if/when needed. Related: [[finishing-conversion-wip]] (these are its Phase 2/3 labels), [[back-half-fulfillment]] (staging label).
