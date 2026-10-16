// Quick add placeholders, pinned (S7, 2026-10-16): the line, the refusals, the open placeholders on a record, the
// held NetSuite write, the resolve (the line rewritten, the held payload filled in place, the queue only on the
// last), and the day summary's rows.
import { placeholderLineOf, isPlaceholderLine, placeholdersOf, hasPlaceholders, nsHoldOf, resolvePlaceholderOf, dayPlaceholdersOf, PLACEHOLDER_HELD_STATUS, PLACEHOLDER_ERP } from '../src/components/Shared/placeholderLine.js';
import { orderDiscountApplies } from '../src/components/Shared/lineDiscount.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const a = placeholderLineOf({ description: 'Hand-loomed lumbar, oatmeal', price: '395', qty: '2', by: 'laetitia', at: 1000 });
ok('a quick add: a line with no item, the description as its name, the price as a rule price the order % reaches', a.ok && a.line.erp === PLACEHOLDER_ERP && a.line.nsId === '' && a.line.name === 'Hand-loomed lumbar, oatmeal' && a.line.rateOverride === 395 && a.line.qty === 2 && a.line.discountable === true && a.line.placeholder.by === 'laetitia' && isPlaceholderLine(a.line) && orderDiscountApplies(a.line));
ok('refusals by name: blank description, bad price, bad quantity', placeholderLineOf({ description: ' ', price: 10 }).errors[0].code === 'NO_DESCRIPTION' && placeholderLineOf({ description: 'x', price: '0' }).errors[0].code === 'NO_PRICE' && placeholderLineOf({ description: 'x', price: 5, qty: 1.5 }).errors[0].code === 'BAD_QTY');

const stored = (extra = {}) => ({
    id: 'QS-1', soId: 'QS-1', customer: 'Patina', createdAt: 5000, status: PLACEHOLDER_HELD_STATUS,
    lines: [
        { erp: 'Bell/10T', nsId: '42889', name: 'Bell throw', qty: 1, rate: 675, note: '' },
        { erp: 'TBD', nsId: '', name: 'Hand-loomed lumbar, oatmeal', qty: 2, rate: 395, note: '', placeholder: { description: 'Hand-loomed lumbar, oatmeal', by: 'laetitia', at: 1000 } },
        { erp: 'TBD', nsId: '', name: 'Brass tray', qty: 1, rate: 120, note: '', placeholder: { description: 'Brass tray', by: 'laetitia', at: 1001 } },
    ],
    nsHold: nsHoldOf({ kind: 'salesorder', label: 'Quick Ship SO · Patina · 3 line(s)', targetUrl: 'https://x/salesorder', payload: { entity: { id: '1' }, memo: 'm', item: { items: [
        { item: { id: '42889' }, quantity: 1, rate: 675, price: { id: '-1' }, description: 'Bell throw', location: { id: '20' } },
        { item: { id: '' }, quantity: 2, rate: 395, price: { id: '-1' }, description: 'Hand-loomed lumbar, oatmeal', location: { id: '20' }, _placeholderLineIdx: 1 },
        { item: { id: '' }, quantity: 1, rate: 120, price: { id: '-1' }, description: 'Brass tray', location: { id: '20' }, _placeholderLineIdx: 2 },
    ] } }, sourceApp: 'QUICKSHIP', writeBack: [{ collection: 'hq_sales_orders', docId: 'QS-1', idField: 'nsInternalId', tranField: 'soId', patch: { status: 'Pending' } }], at: 5000 }),
    ...extra,
});
const rec = stored();
ok('the open placeholders on a stored order, by index', placeholdersOf(rec).map(p => `${p.lineIdx}:${p.description}:${p.qty}`).join('|') === '1:Hand-loomed lumbar, oatmeal:2|2:Brass tray:1' && hasPlaceholders(rec) && !hasPlaceholders({ lines: rec.lines.slice(0, 1) }));
ok('the hold keeps the queue entry whole', rec.nsHold.kind === 'salesorder' && rec.nsHold.payload.item.items.length === 3 && rec.nsHold.writeBack[0].docId === 'QS-1' && rec.nsHold.heldAt === 5000);

const lumbar = { id: 'ID-L', legacyErpId: 'Bridget/07P20x12', itemName: 'Bridget lumbar 07 oatmeal', netSuiteInternalId: '77001', manufacturingSpecs: { homeBin: 'SHOW' } };
const r1 = resolvePlaceholderOf({ record: rec, lineIdx: 1, item: lumbar, by: 'stuart', at: 9000 });
ok('the first identified: the line rewritten to the real item, the description kept as the note, the price untouched, the held item filled in place, NOT released', r1.ok && !r1.release && r1.nsWrite === null && r1.patch.lines[1].erp === 'Bridget/07P20x12' && r1.patch.lines[1].nsId === '77001' && r1.patch.lines[1].rate === 395 && r1.patch.lines[1].bin === 'SHOW' && /sold as "Hand-loomed lumbar, oatmeal"/.test(r1.patch.lines[1].note) && r1.patch.lines[1].placeholder.resolvedTo === 'Bridget/07P20x12' && r1.patch.nsHold.payload.item.items[1].item.id === '77001' && !('_placeholderLineIdx' in r1.patch.nsHold.payload.item.items[1]) && r1.patch.nsHold.payload.item.items[2].item.id === '' && !('status' in r1.patch));
const rec2 = { ...rec, ...r1.patch };
const tray = { id: 'ID-T', legacyErpId: 'TRAY-BR', itemName: 'Brass tray', netSuiteInternalId: '77002', manufacturingSpecs: {} };
const r2 = resolvePlaceholderOf({ record: rec2, lineIdx: 2, item: tray, by: 'stuart', at: 9500 });
ok('the last identified: released — status NS_QUEUED, the hold cleared, the NetSuite write ready with every item id filled', r2.ok && r2.release && r2.patch.status === 'NS_QUEUED' && r2.patch.nsHold === null && r2.patch.nsQueuedAt === 9500 && r2.nsWrite.kind === 'salesorder' && r2.nsWrite.payload.item.items.map(i => i.item.id).join() === '42889,77001,77002' && r2.nsWrite.payload.item.items.every(i => !('_placeholderLineIdx' in i)) && r2.nsWrite.writeBack[0].docId === 'QS-1' && placeholdersOf({ lines: r2.patch.lines }).length === 0);
ok('refusals: an item with no NetSuite id, a line that is not a placeholder, no item', resolvePlaceholderOf({ record: rec, lineIdx: 1, item: { legacyErpId: 'X' } }).errors[0].code === 'ITEM_NO_NS_ID' && resolvePlaceholderOf({ record: rec, lineIdx: 0, item: lumbar }).errors[0].code === 'NOT_PLACEHOLDER' && resolvePlaceholderOf({ record: rec, lineIdx: 1, item: null }).errors[0].code === 'NO_ITEM');
const noHold = resolvePlaceholderOf({ record: { ...rec, nsHold: null, lines: rec.lines.slice(0, 2) }, lineIdx: 1, item: lumbar, at: 1 });
ok('a record with no held write still resolves and releases (nothing to queue)', noHold.ok && noHold.release && noHold.nsWrite === null && noHold.patch.status === 'NS_QUEUED');

const rows = dayPlaceholdersOf([rec, { id: 'Q-2', jobId: 'QSQUOTE-2', customer: { name: 'Katie' }, createdAt: 6000, lines: [{ erp: 'TBD', nsId: '', name: 'Velvet bolster', qty: 1, rate: 240, placeholder: { description: 'Velvet bolster', at: 6001 } }] }, { id: 'old', createdAt: 100, lines: rec.lines }], { start: 1000, end: 10000 });
ok('the day summary rows: every open placeholder of the day, the quote named as a quote, older records left out, newest first', rows.length === 3 && rows[0].kind === 'QUOTE' && rows[0].number === 'QSQUOTE-2' && rows[0].customer === 'Katie' && rows[1].kind === 'SALES ORDER' && rows.every(r => r.recordId !== 'old'));

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
