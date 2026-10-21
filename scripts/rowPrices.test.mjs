// Shared/rowPrices — a price typed over the engine's on one part of a CPQ configuration (Stuart 2026-10-20/21). The rules, then the
// engine's own lines: every row the configurator's Pricing box shows finds its row on the cart line the configuration becomes, and a
// price typed in the box is the price the line carries — the row, the line total, the traverse components NetSuite reads.
//   node scripts/rowPrices.test.mjs
// ROWPRICES_MODULE=<path> runs the same assertions against a mutated copy (mutation check).
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';
import { sessionOf } from '../src/components/Shared/hardwareSession.js';
import { resolve, reseatPicks } from '../src/components/Shared/hardwareModel.js';
import { choicesFromAssembly, modelNodesOf } from '../src/components/Shared/hardwareAdapter.js';

const R = await import(process.env.ROWPRICES_MODULE || new URL('../src/components/Shared/rowPrices.js', import.meta.url).href);
const { priceSettable, factorOf, cleanRowPrices, boxRowKeys, cartRowKeys, typedRow, applyRowPrices, typedCountOf } = R;

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 400)}\n    want ${String(w).slice(0, 400)}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const r2 = (n) => Math.round(n * 100) / 100;

// ── THE RULES ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
eq('a price can be typed on a row with its own money — not a hidden part, a part a kit paid for, a kit\'s own part, or a kit\'s per-foot row',
    [{ total: 5 }, { hidden: true }, { inKit: true }, { coveredQty: 2 }, { kitOf: 'H1-2TRV-CB' }, { billedFeet: 8 }, { billedFeet: 0 }, { isKit: true, total: 195 }, null].map(r => priceSettable(r)),
    [true, false, false, false, false, false, false, true, false]);
eq('the total follows the unit as the engine makes it: × qty, × feet on a pole sold by the foot', [factorOf({ qty: 3 }), factorOf({ qty: 1, perFoot: true, feet: 12 }), factorOf({}), factorOf({ qty: 2, perFoot: true })], [3, 12, 1, 0]);
eq('a typed map keeps $0 and up, to the cent — blanks, words and negatives are not prices', cleanRowPrices({ a: '12.345', b: 0, c: '', d: 'x', e: -1, f: null, g: '7' }), { a: 12.35, b: 0, g: 7 });

const line = {
    id: 'L1', qty: 2, pricing: { finalPrice: 100 },
    pricingBreakdown: [
        { name: 'Rod', partId: 'ROD', role: 'ROD', position: 'FRONT', qty: 1, perFoot: true, feet: 10, price: 4, total: 40 },
        { name: 'Bracket', partId: 'BRK', role: 'BRACKET', position: 'CENTER', qty: 3, price: 10, total: 30 },
        { name: 'Bracket', partId: 'BRK', role: 'BRACKET', position: 'LEFT', qty: 1, price: 10, total: 10 },
        { name: 'Screw', partId: 'SCR', role: 'BRACKET', position: 'CENTER', qty: 6, price: 0, total: 0, hidden: true },
        { name: 'Joiner', partId: 'DOC-JNR', legacyErpId: 'H1-2JNR', qty: 1, price: 20, total: 20, addedByHand: true },
        { name: 'Carrier', partId: 'HTSLNTCAR', legacyErpId: 'HTSLNTCAR', qty: 40, price: 0, total: 0, trvComponent: true },
    ],
    trvComponents: [{ code: 'HTSLNTCAR', qty: 40, rate: 0.5, billable: false, why: 'carriers' }],
};
const keys = cartRowKeys(line.pricingBreakdown);
eq('a cart line\'s rows have one key each: the kind, the part, where it sits', keys,
    ['P|ROD|ROD|FRONT|', 'P|BRK|BRACKET|CENTER|', 'P|BRK|BRACKET|LEFT|', 'P|SCR|BRACKET|CENTER|', 'H|DOC-JNR|||', 'T|HTSLNTCAR|||']);
const typed = applyRowPrices(line, { [keys[0]]: 6, [keys[1]]: 12.5, [keys[3]]: 2, [keys[4]]: '18', [keys[5]]: 0.75, 'P|GONE|||': 9 }, { by: 'Stuart', at: '2026-10-21' });
eq('typed prices land on their rows — the pole per foot, the bracket × its count; a hidden part takes none',
    typed.pricingBreakdown.map(r => [r.price, r.total, !!r.priceSetByHand]), [[6, 60, true], [12.5, 37.5, true], [10, 10, false], [0, 0, false], [18, 18, true], [0.75, 30, true]]);
eq('…the engine\'s own figures kept beside them', typed.pricingBreakdown.filter(r => r.priceSetByHand).map(r => [r.enginePrice, r.engineTotal]), [[4, 40], [10, 30], [20, 20], [0, 0]]);
eq('the line\'s total is its rows\' — the engine\'s kept beside it', [typed.pricing.finalPrice, typed.pricing.engineFinalPrice], [155.5, 100]);
eq('a typed traverse component is what NetSuite is sent: its rate, billed', typed.trvComponents.map(c => [c.rate, c.billable, c.engineRate, c.engineBillable]), [[0.75, true, 0.5, false]]);
eq('the line keeps only the prices that found a row, and who typed them', [typed.rowPrices, typed.rowPricesSet], [{ [keys[0]]: 6, [keys[1]]: 12.5, [keys[4]]: 18, [keys[5]]: 0.75 }, { by: 'Stuart', at: '2026-10-21' }]);
eq('how many were typed, for the cart\'s note', [typedCountOf(typed), typedCountOf(line), typedCountOf(null)], [4, 0, 0]);
eq('applied again with the same prices → the same line', JSON.stringify(applyRowPrices(typed, typed.rowPrices, typed.rowPricesSet)), JSON.stringify(typed));
const back = applyRowPrices(typed, { [keys[1]]: 12.5 });
eq('a price taken away goes back to the engine\'s figures, the component too', [back.pricingBreakdown.map(r => [r.price, r.total]), back.pricing, back.trvComponents[0].rate, back.trvComponents[0].billable, back.trvComponents[0].engineRate],
    [[[4, 40], [12.5, 37.5], [10, 10], [0, 0], [20, 20], [0, 0]], { finalPrice: 107.5, engineFinalPrice: 100 }, 0.5, false, undefined]);
const none = applyRowPrices(typed, {});
eq('every price taken away → the line exactly as the engine built it', JSON.stringify(none), JSON.stringify(line));
eq('a line with nothing typed passes through untouched', applyRowPrices(line, {}), line);
const repeat = cartRowKeys([{ partId: 'A', role: 'RING' }, { partId: 'A', role: 'RING' }, { partId: 'A', role: 'RING', position: 'X' }]);
eq('the same part twice at the same place counts on', repeat, ['P|A|RING||', 'P|A|RING||#2', 'P|A|RING|X|']);
eq('the box shows a typed row with the engine\'s figures for the strike-through', typedRow({ unit: 4, total: 40, qty: 1, perFoot: true, feet: 10 }, 6), { unit: 6, total: 60, qty: 1, perFoot: true, feet: 10, engineUnit: 4, engineTotal: 40, typed: true });

// ── THE ENGINE'S OWN LINES: the box and the cart line agree, row for row (the live H1-2TRV pins of the fixture) ─────────────────────
{
    const choices = choicesFromAssembly(ASSEMBLY, PINS), modelNodes = modelNodesOf(ASSEMBLY);
    const framings = [];
    (function walk(answers) { const open = resolve({ choices, answers, selectedIds: [], modelNodes }).axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null); if (!open) { framings.push(answers); return; } open.values.forEach(v => walk({ ...answers, [open.key]: v })); })({});
    const hh = (t) => { let x = 2166136261; for (const c of String(t)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
    // prices on some parts, none on others (the case Stuart types over), an add-by-hand joiner and a traverse chart with a billable component
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName,
        manufacturingSpecs: hh(p.partId) % 3 ? { basePrice: (hh(p.partId) % 40) + 2 } : {} }])).values()];
    parts.push({ id: 'DOC-JNR', itemId: 'DOC-JNR', legacyErpId: 'H1-2JNR', itemName: 'Joiner', manufacturingSpecs: { basePrice: 20 } }, { id: 'DOC-WAND', itemId: 'DOC-WAND', legacyErpId: 'WAND-36', itemName: 'Wand', manufacturingSpecs: { basePrice: 14 } });
    const CHART = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 8: 32, 12: 48 } }], configurator: [{ itemId: 'WAND-36', drive: 'MANUAL', billable: true }] };
    const data = { assembly: ASSEMBLY, pins: PINS, parts, flow: { kitFamily: 'H1-2TRV' }, trvRules: CHART, extraItems: [{ code: 'H1-2JNR', label: 'Joiner' }] };
    const findPart = (code) => parts.find(p => [p.id, p.itemId, p.legacyErpId].some(k => String(k || '').toUpperCase() === String(code || '').toUpperCase())) || null;
    let configs = 0, rows = 0, typedRows = 0, perFoot = 0, hand = 0, trv = 0; const wrong = [];
    framings.forEach((answers, fi) => {
        let picks = {};
        for (let g = 0; g < 40; g++) { const m = resolve({ choices, answers, selectedIds: Object.values(picks), modelNodes }); picks = reseatPicks(m, picks); const sl = m.slots.find(s => !picks[s.key] && s.options.length && !s.suppressedBy); if (!sl) break; picks[sl.key] = sl.options[(hh(`${fi}|${sl.key}`)) % sl.options.length].id; }
        for (const lengthInches of [96, 150]) {
            const s = sessionOf(data, { answers, picks, lengthInches, extras: fi % 2 ? [{ code: 'H1-2JNR', qty: 1 }] : [], trvSel: s0trv(fi) });
            if (!s.item) continue;
            configs++;
            const bk = boxRowKeys({ lines: s.priced.lines, extraLines: s.extraLines, trvLines: s.trvLines, findPart: s.findPart || findPart });
            const ck = cartRowKeys(s.item.pricingBreakdown);
            const box = [...s.priced.lines.map((l, i) => [bk.lines[i], l]), ...s.extraLines.map((l, i) => [bk.extraLines[i], l]), ...s.trvLines.map((l, i) => [bk.trvLines[i], l])];
            // every box row finds its cart row, and they are the same part at the same money
            box.forEach(([k, l]) => {
                rows++;
                const at = ck.indexOf(k);
                if (at < 0) { wrong.push(`${fi}@${lengthInches}: ${k} not on the line`); return; }
                const row = s.item.pricingBreakdown[at];
                if (Math.abs((Number(row.total) || 0) - (Number(l.total) || 0)) > 0.005) wrong.push(`${fi}@${lengthInches}: ${k} box $${l.total} line $${row.total}`);
            });
            if (new Set(ck).size !== ck.length) wrong.push(`${fi}@${lengthInches}: a cart key twice`);
            // a price typed on every row the box can type → the line carries exactly what the box shows
            const map = {};
            box.forEach(([k, l], j) => { if (!l.hidden && priceSettable(s.item.pricingBreakdown[ck.indexOf(k)])) map[k] = 3 + (j % 7) * 1.25; });
            const out = applyRowPrices(s.item, map);
            let want = 0;
            box.forEach(([k, l]) => { const shown = Object.prototype.hasOwnProperty.call(map, k) ? typedRow(l, map[k]) : l; want += Number(shown.total) || 0;
                const row = out.pricingBreakdown[ck.indexOf(k)];
                if (!row) return;   // (said above: not on the line)
                if (Math.abs((Number(row.total) || 0) - (Number(shown.total) || 0)) > 0.005) wrong.push(`${fi}@${lengthInches}: typed ${k} box $${shown.total} line $${row.total}`);
                if (Object.prototype.hasOwnProperty.call(map, k)) { typedRows++; if (l.perFoot) perFoot++; if (l.extra && String(k).startsWith('H')) hand++; if (String(k).startsWith('T')) trv++; } });
            // rows the box does not list (hidden) still bill as the engine priced them
            const hiddenMoney = s.item.pricingBreakdown.filter((r, i) => !box.some(([k]) => k === ck[i])).reduce((t, r) => t + (Number(r.total) || 0), 0);
            if (Math.abs(out.pricing.finalPrice - r2(want + hiddenMoney)) > 0.01) wrong.push(`${fi}@${lengthInches}: line $${out.pricing.finalPrice} box $${r2(want + hiddenMoney)}`);
            if (Math.abs(out.pricing.engineFinalPrice - s.item.pricing.finalPrice) > 0.005) wrong.push(`${fi}@${lengthInches}: the engine's total not kept`);
        }
    });
    function s0trv(fi) { return fi % 3 === 0 ? { carrierStyle: 'HTSLNTCAR', carrierQty: '', draw: 'CENTER', motorSide: '', picks: {}, accessories: { 'WAND-36': 1 } } : null; }
    eq(`the box and the line agree row for row, typed or not (${configs} configurations, ${rows} rows)${wrong.length ? ` — ${wrong.slice(0, 3).join('; ')}` : ''}`, wrong.length, 0);
    ok(`…reached: ${typedRows} typed rows (${perFoot} by the foot, ${hand} added by hand, ${trv} traverse components)`, configs > 15 && typedRows > 60 && perFoot > 5 && hand > 3 && trv > 3);
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
