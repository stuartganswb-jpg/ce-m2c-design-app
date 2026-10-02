// 🔩 Automatic hardware off the customer's paper; a kit says its finish (Stuart 2026-10-02, QUO188).   node scripts/autoParts.test.mjs
import { isAutoPartLine, leftOffCustomerPaper } from '../src/components/Shared/autoParts.js';
import { customerDocLines } from '../src/components/Shared/lineClassification.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── what the save marks ─────────────────────────────────────────────────────────────────────
eq('an F-clip hanger', isAutoPartLine({ role: 'FCLIP', legacyErpId: 'H1-2TRVCLP' }), true);
eq('a manual end PLUG the drive settles', isAutoPartLine({ role: 'TRV_END', legacyErpId: 'H1-2TRVPLUG' }), true);
eq('a MOTORISED end is a real choice — not marked', isAutoPartLine({ role: 'TRV_END', legacyErpId: 'HSOM-21' }), false);
eq('an end stopper from the traverse chart', isAutoPartLine({ trvComponent: true, legacyErpId: 'HTTENDSTOP' }), true);
eq('the carriers stay ("they need to see/confirm selection")', [isAutoPartLine({ trvComponent: true, legacyErpId: 'HTSLNTCAR' }), isAutoPartLine({ role: 'CARRIER', legacyErpId: 'HTRF80-500' })], [false, false]);
eq('a bracket, a plate, a finial, a rod — never', ['BRACKET', 'BACKPLATE', 'FINIAL', 'ROD'].map(role => isAutoPartLine({ role, legacyErpId: 'X' })), [false, false, false, false]);
eq('an end stopper ADDED by hand (not the chart) is the customer\'s', isAutoPartLine({ legacyErpId: 'HTTENDSTOP' }), false);
eq('nothing', [isAutoPartLine(null), isAutoPartLine({})], [false, false]);
eq('left off only while it bills nothing', [leftOffCustomerPaper({ autoPart: true, total: 0 }), leftOffCustomerPaper({ autoPart: true, total: 4 }), leftOffCustomerPaper({ total: 0 })], [true, false, false]);

// ── QUO188's second configuration, as the order saves it ────────────────────────────────────
const cfg = [
    { name: '▶ H1-2TRV []', isHeader: true, qty: 1, total: 90 },
    { name: '  - 2" x 3/4" Rectangular Rod Wood Mill', legacyErpId: 'H1-2RCTWR-O', qty: 1, price: 15, total: 15, perFoot: true, feet: 1, finishCode: 'S11', clientFinishName: 'Pure Oak' },
    { name: '  - Miter Return 2" Rectangular Rod', legacyErpId: 'H1-2TRVMTR', clientSku: 'H1-2TRMR', qty: 1, price: 45, total: 45, finishCode: 'S11' },
    { name: '  - End Plug for 1.5" Square Traverse', legacyErpId: 'H1-2TRVPLUG', qty: 1, price: 0, total: 0, autoPart: true },
    { name: '  - F-Clip Hanger for 1.5" Square Traverse Track', legacyErpId: 'H1-2TRVCLP', qty: 1, price: 0, total: 0, autoPart: true },
    { name: '  - HTRF80-500 — 80% RF Carriers — included per 1ft chart', legacyErpId: 'HTRF80-500', qty: 6, price: 0, total: 0 },
    { name: '  - HTTENDSTOP — included component', legacyErpId: 'HTTENDSTOP', qty: 2, price: 0, total: 0, autoPart: true },
    // QUO188's third: the acrylic end cap kit, its collar in EP1, and a metal cap in EP2
    { name: '▶ H1-2TRV []', isHeader: true, qty: 1, total: 98 },
    { name: '  - Acrylic End Cap w/Collar for 2" Rectangular Rod', legacyErpId: 'H1-2RCTAEC', clientSku: 'H5512F PREMIUM', qty: 1, price: 45, total: 45, isKit: true, itemKit: true, noNs: true },
    { name: '  - Collar for Acrylic End for 2" Rectangle Rod', legacyErpId: 'H1-2RCTAECC/EP1', qty: 1, price: 0, total: 0, finishCode: 'EP1', finishLabel: 'Satin Nickel', clientFinishName: 'Satin Nickel', inKit: true, hidden: true, kitOf: 'H1-2RCTAEC' },
    { name: '  - Acrylic End Cap Tip for 2" Rectangular Rod', legacyErpId: 'H1-2RCTACEC', qty: 1, price: 0, total: 0, inKit: true, hidden: true, kitOf: 'H1-2RCTAEC', noFinish: true },
    { name: '  - Metal End Cap for 2" Rectangle Rod', legacyErpId: 'H1-2RCTEC/EP2', clientSku: 'H5511F PREMIUM', qty: 1, price: 34, total: 34, finishCode: 'EP2', clientFinishName: 'Polished Nickel' },
];
for (const type of ['QUOTE', 'SALES_ORDER', 'INVOICE']) {
    const out = customerDocLines(cfg, type);
    const codes = out.filter(l => !l.isNetLine).map(l => l.legacyErpId);
    ok(`${type}: no F-clip, no end plug, no end stopper`, !codes.some(c => /TRVCLP|TRVPLUG|HTTENDSTOP/.test(c)));
    ok(`${type}: the carriers are still there for the customer to confirm`, codes.includes('HTRF80-500'));
    const kit = out.find(l => l.legacyErpId === 'H5512F PREMIUM');
    ok(`${type}: the acrylic end cap kit says its collar's finish — EP1`, !!kit && /Finish: Satin Nickel \(EP1\)/.test(kit.name));
    const cap = out.find(l => l.legacyErpId === 'H5511F PREMIUM');
    ok(`${type}: and the metal cap on the other end says EP2`, !!cap && /Finish: Polished Nickel \(EP2\)/.test(cap.name));
    ok(`${type}: the kit's own parts stay off (hidden), as before`, !codes.some(c => /RCTAECC|RCTACEC/.test(c)));
}
const shop = customerDocLines(cfg, 'PACKING_SLIP').map(l => l.legacyErpId);
ok('the packing slip still lists the clip, the plug and the stoppers', ['H1-2TRVCLP', 'H1-2TRVPLUG', 'HTTENDSTOP'].every(c => shop.includes(c)));
eq('a line marked automatic that DOES bill prints', customerDocLines([{ name: 'clip', legacyErpId: 'H1-2TRVCLP', qty: 4, price: 2, total: 8, autoPart: true }], 'QUOTE').map(l => l.legacyErpId), ['H1-2TRVCLP']);
eq('a kit with no finished part inside it is left as it was', customerDocLines([{ name: 'kit', legacyErpId: 'K', qty: 1, price: 5, total: 5, isKit: true, itemKit: true }, { name: 'p', legacyErpId: 'P', inKit: true, hidden: true, kitOf: 'K', total: 0 }], 'QUOTE')[0].name, 'kit');
eq('a kit\'s finish never borrows from the next kit\'s parts', customerDocLines([{ name: 'kit A', legacyErpId: 'A', qty: 1, price: 5, total: 5, isKit: true, itemKit: true }, { name: 'kit B', legacyErpId: 'B', qty: 1, price: 5, total: 5, isKit: true, itemKit: true }, { name: 'p', legacyErpId: 'P/EP3', finishCode: 'EP3', inKit: true, hidden: true, kitOf: 'B', total: 0 }], 'QUOTE').map(l => l.name), ['kit A', 'kit B — Finish: EP3']);

console.log(`autoParts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
