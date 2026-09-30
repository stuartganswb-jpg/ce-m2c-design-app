// 🧷 The CPQ workspace survives a tab switch and a reload (Eric 2026-09-29 · Stuart 2026-09-30).   node scripts/cpqWorkspace.test.mjs
import {
    workHasProgress, workIsPristine, workspaceIsEmpty, readWorkspace, writeWorkspace, clearAllWorkspaces,
    restorableWorkspace, workspaceSeedOf, workspaceKey, WORKSPACE_VERSION,
} from '../src/components/Shared/cpqWorkspace.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// A localStorage stand-in.
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m }; };

// The test line from the repro: H1-1 for Fabricut, 116", caps, three brackets, rings, P14.
const work = {
    assemblyId: 'ASM-H1-1', answers: { setup: 'SINGLE', mount: 'WALL' }, picks: { rod: 'H1-1R', leftEnd: 'H1-1CC', rightEnd: 'H1-1CC', leftBkt: 'H1-1BS' },
    partFinish: {}, globalFinishes: { METAL: 'P14' }, globalFinish: 'P14', stepQty: {}, stepNotes: {}, extras: [], lengthInches: 116,
    memo: 'TEST REPRO — APP IMP', qty: '1', kitPick: '', kitMotor: '', trvSel: null, fabricId: 'PRINT', sizePick: {}, stepIx: 4, drawnSplices: [], visionSeededId: '',
};
const fresh = { assemblyId: 'ASM-H1-1', answers: {}, picks: {}, partFinish: {}, globalFinishes: {}, globalFinish: '', stepQty: {}, stepNotes: {}, extras: [], lengthInches: null, memo: '', qty: '1', kitPick: '', trvSel: null, fabricId: 'PRINT', sizePick: {}, stepIx: 0 };
const header = { jobData: { customerId: 'CUST-4720', jobName: '', sidemark: '', needBy: '', productionNotes: '', shippingMethod: 'SAVED', shippingAddressId: '', shippingAmount: '', customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } }, priceLevel: 'STANDARD', addOnSel: {} };
const engine = { newEngine: true, activeFlowId: 'FLOW-H1-1', activeAssemblyId: 'ASM-H1-1', pendingGroup: '', editingCartId: null, activeDraftId: null };
const ws = { v: WORKSPACE_VERSION, sessionId: null, header, engine, oldEngine: {}, config: work };

// ── progress: what the Edit question asks ───────────────────────────────────────────────────
ok('a configuration being built is in progress', workHasProgress(work));
ok('a freshly opened configurator is not', !workHasProgress(fresh));
ok('a finish left selected after Add is not in progress (it stays for the next line)', !workHasProgress({ ...fresh, globalFinishes: { METAL: 'P14' }, globalFinish: 'P14' }));
ok('a toggled-off answer (undefined) is not progress', !workHasProgress({ ...fresh, answers: { setup: undefined } }));
ok('the traverse panel filling itself is not progress', !workHasProgress({ ...fresh, trvSel: { carriers: 'STD' } }));
ok('a typed length is', workHasProgress({ ...fresh, lengthInches: 60 }));
ok('a step note is', workHasProgress({ ...fresh, stepNotes: { rod: 'cut short' } }));
ok('a hand-added extra is', workHasProgress({ ...fresh, extras: [{ code: 'H1-1SPL', qty: '1' }] }));
ok('a kit pick is', workHasProgress({ ...fresh, kitPick: 'KIT-1' }));
ok('nothing at all is not', !workHasProgress(null));

// ── pristine: what is not worth saving ──────────────────────────────────────────────────────
ok('a fresh configurator is pristine', workIsPristine(fresh));
ok('a finish alone is worth keeping', !workIsPristine({ ...fresh, globalFinishes: { METAL: 'P14' } }));
ok('being on step 5 is worth keeping', !workIsPristine({ ...fresh, stepIx: 4 }));
ok('two of this configuration is worth keeping', !workIsPristine({ ...fresh, qty: '2' }));
ok('a heavier fabric is worth keeping', !workIsPristine({ ...fresh, fabricId: 'HEAVY' }));

// ── empty workspaces are removed, not stored ────────────────────────────────────────────────
const blankHeader = { ...header, jobData: { ...header.jobData, customerId: '' } };
ok('nothing chosen at all → empty', workspaceIsEmpty({ header: blankHeader, engine: { newEngine: true }, config: fresh }));
ok('a customer alone is kept', !workspaceIsEmpty({ header, engine: {}, config: null }));
ok('an open flow alone is kept', !workspaceIsEmpty({ header: blankHeader, engine, config: null }));
ok('a typed ship-to street alone is kept', !workspaceIsEmpty({ header: { ...blankHeader, jobData: { ...blankHeader.jobData, customShippingAddress: { ...blankHeader.jobData.customShippingAddress, addr1: '1 Main St' } } }, engine: {} }));
ok('a price level other than standard is kept', !workspaceIsEmpty({ header: { ...blankHeader, priceLevel: 'FAB1' }, engine: {} }));

// ── storage round trip, per division ────────────────────────────────────────────────────────
const s = mem();
writeWorkspace(s, 'ce', ws);
eq('saved under the division', [...s._m.keys()], [workspaceKey('ce')]);
eq('read back whole', readWorkspace(s, 'ce').config.picks, work.picks);
eq('another division reads nothing', readWorkspace(s, 'm2c'), null);
writeWorkspace(s, 'ce', { ...ws, header: blankHeader, engine: { newEngine: true }, config: fresh });
eq('writing an empty workspace removes it', readWorkspace(s, 'ce'), null);
s.setItem(workspaceKey('ce'), '{not json');
eq('an unreadable one reads as none', readWorkspace(s, 'ce'), null);
s.setItem(workspaceKey('ce'), JSON.stringify({ ...ws, v: 99 }));
eq('another version reads as none', readWorkspace(s, 'ce'), null);
writeWorkspace(s, 'ce', ws); writeWorkspace(s, 'm2c', ws); s.setItem('hq_global_cart', '[]');
clearAllWorkspaces(s);
eq('a CRM reopen clears every division, and nothing else', [...s._m.keys()], ['hq_global_cart']);
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, get length() { return 1; } };
ok('blocked storage never throws', (() => { try { readWorkspace(broken, 'ce'); writeWorkspace(broken, 'ce', ws); clearAllWorkspaces(broken); return true; } catch { return false; } })());

// ── what may come back ──────────────────────────────────────────────────────────────────────
const cart = [{ id: 'LINE-1' }];
let r = restorableWorkspace(ws, { sessionId: null, cart });
eq('same (fresh) quote → header, engine and the configuration come back', [r.header.jobData.customerId, r.engine.activeFlowId, r.config.memo], ['CUST-4720', 'FLOW-H1-1', 'TEST REPRO — APP IMP']);
eq('another quote session → nothing', restorableWorkspace(ws, { sessionId: 'QUO200', cart }), null);
eq('a fresh quote does not take a reopened quote\'s work', restorableWorkspace({ ...ws, sessionId: 'QUO200' }, { sessionId: null, cart }), null);
eq('the same reopened quote → it comes back', restorableWorkspace({ ...ws, sessionId: 'QUO200' }, { sessionId: 'QUO200', cart }).engine.activeFlowId, 'FLOW-H1-1');
r = restorableWorkspace({ ...ws, engine: { ...engine, editingCartId: 'LINE-1' } }, { cart });
eq('the line being edited is still in the cart → still being edited', r.engine.editingCartId, 'LINE-1');
r = restorableWorkspace({ ...ws, engine: { ...engine, editingCartId: 'LINE-9' } }, { cart });
eq('the edited line left the cart → no longer being edited, the work stays', [r.engine.editingCartId, !!r.config], [null, true]);
r = restorableWorkspace({ ...ws, engine: { ...engine, activeFlowId: 'FLOW-H1-138', activeAssemblyId: 'ASM-H1-138' } }, { cart });
eq('a configuration never lands on another assembly', [r.config, r.engine.activeFlowId], [null, 'FLOW-H1-138']);
r = restorableWorkspace({ ...ws, config: { ...work, assemblyId: '' } }, { cart });
eq('a configuration that names no assembly is not guessed', r.config, null);
r = restorableWorkspace({ ...ws, config: fresh }, { cart });
eq('a pristine configuration is not handed back', r.config, null);

// ── the seed: Edit's door ───────────────────────────────────────────────────────────────────
const seed = workspaceSeedOf(work, 42);
eq('the seed is keyed, scoped to its assembly and marked', [seed.key, seed.forAssemblyId, seed.fromWorkspace, seed.assemblyId], [42, 'ASM-H1-1', true, undefined]);
eq('it carries the operator\'s picks and the rest as saved', [seed.picks, seed.lengthInches, seed.memo, seed.stepIx, seed.globalFinishes], [work.picks, 116, 'TEST REPRO — APP IMP', 4, { METAL: 'P14' }]);
eq('no configuration → no seed', workspaceSeedOf(null, 1), null);

console.log(`cpqWorkspace: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
