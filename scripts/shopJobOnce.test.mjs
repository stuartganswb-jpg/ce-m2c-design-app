// 🔒 A shop job is written once; a row's job is one configuration; a copy that came back says so (Eric 2026-10-02, SO60585 Row 2).
// node scripts/shopJobOnce.test.mjs
import { shopWriteDecision, keptShopJobText, isPairShopDoc, shopConfigsOf, alreadyDoneOf, alreadyDoneClosePatch } from '../src/components/Shared/shopJobOnce.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── create once ─────────────────────────────────────────────────────────────────────────────
// Row 2 as Eric left it at 12:29 — and RTG releasing it again at 12:55.
const row2 = { id: 'SHOP-WO-OE-SO60585-7242-C', status: 'Sent to Plating', completedBy: 'Eric', rowKey: 'ROW_2', quoteId: 'QUOTE-1789763210475', finSiblingId: 'WO-OE-SO60585-7242', isOutsourced: true };
eq('no job yet: create it', shopWriteDecision(null), 'CREATE');
eq('a job exists: KEEP it — the 12:55 release no longer resets Row 2', shopWriteDecision(row2), 'KEEP');
eq('…whatever its status, even Pending (a release never rewrites a job)', shopWriteDecision({ id: 'X', status: 'Pending' }), 'KEEP');
eq('only RTG\'s confirmed Re-dispatch replaces', shopWriteDecision(row2, { replace: true }), 'REPLACE');
eq('the line the release logs', keptShopJobText(row2), 'SHOP-WO-OE-SO60585-7242-C is already on the shop floor (Sent to Plating, completed by Eric) — not re-written.');

// ── a pair's job is one configuration ───────────────────────────────────────────────────────
const cfgs = { 'QUOTE-1789763210475': [{ key: 'cfg0', label: 'Row 2' }, { key: 'cfg1', label: 'Row 3' }, { key: 'cfg2', label: 'Row 4' }, { key: 'cfg3', label: 'Row 5' }, { key: 'cfg4', label: 'Row 6' }] };
eq('a row\'s job lists no other rows', shopConfigsOf(row2, cfgs), []);
eq('a pair is known by its row, its own id or its finishing half\'s id', [isPairShopDoc({ rowKey: 'ROW_3' }), isPairShopDoc({ id: 'SHOP-WO-OE-SO60586-1234-C' }), isPairShopDoc({ id: 'X', finSiblingId: 'WO-OE-SO60586-1234' })], [true, true, true]);
const whole = { id: 'SHOP-SO60585', quoteId: 'QUOTE-1789763210475', finSiblingId: 'WO-SO60585' };
eq('the whole-quote job keeps its checklist (one box per configuration)', shopConfigsOf(whole, cfgs).length, 5);
eq('…and a whole-order split per finish (WO-<key>-<FINISH>) is not a pair', isPairShopDoc({ id: 'SHOP-SO60585-EP2', finSiblingId: 'WO-SO60585-EP2' }), false);
eq('no quote: nothing to list', shopConfigsOf({ id: 'SHOP-WO-123' }, cfgs), []);

// ── a copy that came back ───────────────────────────────────────────────────────────────────
// What RTG's 12:55 write left: a Pending Row 2 job whose finishing half reads Sent to Plating since 12:29.
const phantom = { ...row2, status: 'Pending', completedBy: undefined };
const fin = { id: 'WO-OE-SO60585-7242', customFabStatus: 'Sent to Plating', customFabAt: 1790958573355 };
eq('Row 2 now: the finishing half says done, the job says Pending', alreadyDoneOf(phantom, fin, { plated: true }), { siblingStatus: 'Sent to Plating', siblingAt: 1790958573355, closeStatus: 'Sent to Plating' });
eq('…after the put-away (Complete) it still reads as done', alreadyDoneOf(phantom, { ...fin, customFabStatus: 'Complete' }, { plated: true }).siblingStatus, 'Complete');
eq('an in-house job closes as Completed', alreadyDoneOf({ id: 'S', status: 'Pending' }, { customFabStatus: 'Complete' }).closeStatus, 'Completed');
eq('the ordinary job: finishing waits on the shop — nothing to say', [alreadyDoneOf({ status: 'Pending' }, { customFabStatus: 'Pending' }), alreadyDoneOf({ status: 'In Process' }, { customFabStatus: 'In Process' })], [null, null]);
eq('a job already closed or completed: nothing to say', [alreadyDoneOf({ status: 'Completed' }, fin), alreadyDoneOf({ status: 'Sent to Plating' }, fin), alreadyDoneOf({ status: 'Pending', closed: true }, fin)], [null, null, null]);
eq('no sibling: nothing to say', alreadyDoneOf(phantom, null), null);

const patch = alreadyDoneClosePatch(alreadyDoneOf(phantom, fin, { plated: true }), { by: 'Eric', now: 5 });
eq('the close writes the shop job only: its done status and who closed it — no sibling mirror, no plating card', patch, { status: 'Sent to Plating', completedAt: 5, completedBy: 'Eric', alreadyDoneClose: { by: 'Eric', at: 5, siblingStatus: 'Sent to Plating', siblingAt: 1790958573355 } });
eq('nothing to close: no patch', alreadyDoneClosePatch(null), null);

console.log(`shopJobOnce: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
