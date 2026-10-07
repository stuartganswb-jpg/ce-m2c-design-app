// Harness for Shared/itemDelete.js — the true delete of a library item (4.5, Stuart 2026-10-06): what may go, what the
// app's own configuration still holds, and what else is keyed to the record and has to go with it.
//   node scripts/itemDelete.test.mjs
import { planItemDelete, residualsOf, ledgerRecordOf, samePlan, itemNumberOf, itemLabelOf, deleteChunks, applyItemDelete, lineCountOf } from '../src/components/Shared/itemDelete.js';
import { recordDeletion, DELETION_LEDGER } from '../src/components/Shared/orderLifecycle.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const item = (id, code, name, extra = {}) => ({ id, legacyErpId: code, itemName: name, brandId: 'ce', ...extra });
const ids = (list) => list.map(p => p.id);
const usesOf = (plan, id) => (plan.refused.find(r => r.part.id === id) || { uses: null }).uses;

// ── THE LIBRARY ──────────────────────────────────────────────────────────────────────────────────
const BS = item('CE-INV-100', 'H1-1BS', 'Basic Bracket', { netSuiteInternalId: '100',
    manufacturingSpecs: { customData: { materialTwins: [{ material: 'BRASS', code: 'H1-1BBS' }] } } });
const BBS = item('CE-INV-200', 'H1-1BBS', 'Brass Basic Bracket', { netSuiteInternalId: '200' });
const BBS2 = item('CE-INV-201', 'H1-1BBS', 'Brass Basic Bracket (duplicate)', { netSuiteInternalId: 201 });
const BSP = item('CE-INV-101', 'H1-1BS/P', 'Basic Bracket, phosphated', { netSuiteInternalId: '101' });
const BSEP = item('CE-INV-102', 'H1-1BS/EP2', 'Basic Bracket, nickel', { netSuiteInternalId: '102' });
const JUNK = item('CE-INV-900', 'H1-1ZZ', 'Loaded by mistake', { netSuiteInternalId: '900' });
const ROD = item('CE-INV-300', 'H1-1R', 'Rod', { netSuiteInternalId: '300' });
const WR = item('CE-INV-400', 'H1-138WR', 'Wood rod', { manufacturingSpecs: { customData: { speciesMap: { '-O': 'H1-138WHTOAK', '-W': 'H1-138WLNUT' } } } });
const OAK = item('CE-INV-401', 'H1-138WHTOAK', 'White oak rod');
const KIT = item('KIT-1', 'H1-1KIT', 'Bracket kit', { partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ partId: 'CE-INV-500', qty: 2 }] } });
const COMP = item('CE-INV-500', 'H1-1SCR', 'Screw pack');
const ALIAS = item('ALIAS-1', 'H3654F', 'Their bracket', { partClass: 'Alias', aliasOf: 'CE-INV-600' });
const REAL = item('CE-INV-600', 'H1-1DS', 'Decorative bracket');
const ASM = item('CE-ASM-700', 'H1-1', '1" master', { recordType: 'PRODUCT', nodeClusters: [{ name: 'LEFT', partId: 'CE-INV-710' }] });
const SLOT = item('CE-INV-710', 'H1-1EC', 'End cap');
const SUB = item('CE-ASM-720', 'H1-1SUB', 'Sub-assembly');
const P1 = item('TMP-1', 'PENDING', 'Draft one'), P2 = item('TMP-2', 'PENDING', 'Draft two');
const ALL = [BS, BBS, BBS2, BSP, BSEP, JUNK, ROD, WR, OAK, KIT, COMP, ALIAS, REAL, ASM, SLOT, SUB, P1, P2];

const PINS = [
    { id: 'pin1', assemblyId: 'CE-ASM-700', partId: 'CE-INV-300', clusterId: 'c1' },      // the rod, by record id
    { id: 'pin2', assemblyId: 'CE-ASM-720', partId: 'h1-1zz' },                            // the junk item, by NUMBER (any case)
    { id: 'pin3', assemblyId: 'CE-ASM-720', partId: 'PENDING' },
];
const FLOWS = [
    { id: 'F1', name: 'H1-1 · 1" Metal', linkedAssemblyId: 'CE-ASM-700', steps: [
        { title: 'Brackets', styleOptions: [{ partId: 'CE-INV-100', name: 'Basic' }], subOptions: [], includedParts: [{ partId: 'CE-INV-710' }] },
        { title: 'Kits', styleOptions: [{ partId: 'KIT-1' }] },
    ] },
];
const plan = (selectedIds, over = {}) => planItemDelete({ selectedIds, items: ALL, pins: PINS, flows: FLOWS, ...over });

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────────
{
    eq('the item number', [itemNumberOf(BS), itemNumberOf(P1), itemNumberOf({ id: 'x', legacyErpId: 'PENDING', itemId: 'ab-1' }), itemNumberOf(null)], ['H1-1BS', '', 'AB-1', '']);
    eq('how a record is named', [itemLabelOf(BS), itemLabelOf(P1), itemLabelOf({ id: 'x' })], ['H1-1BS — Basic Bracket', 'TMP-1 — Draft one', 'x']);
}
// ── WHAT MAY GO ──────────────────────────────────────────────────────────────────────────────────
{
    const p = plan(['CE-INV-401']);
    eq('named by nobody by record — but the wood rod names it as its species item', [ids(p.deletable), usesOf(p, 'CE-INV-401')],
        [[], ['H1-138WR — Wood rod names it as its -O species item — by number, and no other record would carry it']]);
    const free = plan(['TMP-1']);
    eq('a record nothing names goes', [ids(free.deletable), free.refused, free.missing], [['TMP-1'], [], []]);
    eq('"PENDING" is not a number — a pin that says PENDING holds nothing', ids(plan(['TMP-1', 'TMP-2']).deletable), ['TMP-1', 'TMP-2']);
    eq('ticked but already gone from the library', plan(['TMP-1', 'NOPE']).missing, ['NOPE']);
}
// ── WHAT IS HELD, AND BY WHAT ────────────────────────────────────────────────────────────────────
{
    eq('a BOM line, by record id', usesOf(plan(['CE-INV-300']), 'CE-INV-300'), ['on the bill of materials of H1-1 — 1" master']);
    eq('a BOM line, by item number', usesOf(plan(['CE-INV-900']), 'CE-INV-900'), ['on the bill of materials of H1-1SUB — Sub-assembly — by number, and no other record would carry it']);
    eq('a CPQ flow option names the step', usesOf(plan(['CE-INV-100']), 'CE-INV-100'), ['CPQ flow "H1-1 · 1" Metal" — Brackets']);
    eq('a part a flow step includes', usesOf(plan(['CE-INV-710']), 'CE-INV-710').sort(),
        ['CPQ flow "H1-1 · 1" Metal" — Brackets', 'item H1-1 — 1" master names it (nodeClusters[0].partId)'].sort());
    eq('an assembly a CPQ flow is built on is held by the flow — its own lines are not what holds it', usesOf(plan(['CE-ASM-700']), 'CE-ASM-700'), ['CPQ flow "H1-1 · 1" Metal"']);
    eq('a kit component', usesOf(plan(['CE-INV-500']), 'CE-INV-500'), ['kit H1-1KIT — Bracket kit lists it as a component']);
    eq('an alias target', usesOf(plan(['CE-INV-600']), 'CE-INV-600'), ['alias H3654F — Their bracket points to it']);
    eq('the alias itself is free to go', ids(plan(['ALIAS-1']).deletable), ['ALIAS-1']);
    eq('…and then so is what it pointed to', ids(plan(['ALIAS-1', 'CE-INV-600']).deletable), ['ALIAS-1', 'CE-INV-600']);
}
// ── AN ASSEMBLY GOES WITH ITS OWN BILL OF MATERIALS ──────────────────────────────────────────────
{
    const sub = plan(['CE-ASM-720']);
    eq('an assembly nothing uses may go, and its own lines go with it', [ids(sub.deletable), Object.keys(sub.lines), sub.lines['CE-ASM-720'].map(l => l.id), lineCountOf(sub)],
        [['CE-ASM-720'], ['CE-ASM-720'], ['pin2', 'pin3'], 2]);
    eq('a record with no lines of its own has none listed', [plan(['TMP-1']).lines, lineCountOf(plan(['TMP-1']))], [{}, 0]);
    eq('the part on its bill of materials is free once the assembly goes too', ids(plan(['CE-ASM-720', 'CE-INV-900']).deletable), ['CE-ASM-720', 'CE-INV-900']);
    eq('…but not on its own: the line still names it', ids(plan(['CE-INV-900']).deletable), []);
    const held = plan(['CE-ASM-700', 'CE-INV-300']);
    eq('an assembly that stays keeps its lines, and its lines keep their parts', [ids(held.deletable), held.lines, usesOf(held, 'CE-INV-300')], [[], {}, ['on the bill of materials of H1-1 — 1" master']]);
    const free = plan(['CE-ASM-700', 'CE-INV-300'], { flows: [] });
    eq('with no flow on it, the assembly, its line and the rod go together', [ids(free.deletable), free.lines['CE-ASM-700'].map(l => l.id)], [['CE-ASM-700', 'CE-INV-300'], ['pin1']]);
    // A sub-assembly on ANOTHER assembly's bill of materials is a part there, and held like any part.
    const nested = plan(['CE-ASM-720'], { pins: [...PINS, { id: 'pin8', assemblyId: 'CE-ASM-700', partId: 'CE-ASM-720' }] });
    eq('used on another assembly\'s bill of materials: held', [ids(nested.deletable), usesOf(nested, 'CE-ASM-720')], [[], ['on the bill of materials of H1-1 — 1" master']]);
    // A flow step tied to one of its lines holds the assembly.
    const tied = plan(['CE-ASM-720'], { flows: [{ id: 'F2', name: 'Sub flow', steps: [{ title: 'Screws', linkedPinId: 'pin2' }] }] });
    eq('a CPQ flow step tied to one of its lines: held', [ids(tied.deletable), usesOf(tied, 'CE-ASM-720')], [[], ['CPQ flow "Sub flow" — Screws uses one of its bill-of-materials lines']]);
    // Lines filed under the assembly's NUMBER, not its record: not this record's to delete, so they hold it.
    const filed = plan(['CE-ASM-720'], { pins: [{ id: 'pinN', assemblyId: 'h1-1sub', partId: 'CE-INV-500' }] });
    eq('lines filed under its number hold it', usesOf(filed, 'CE-ASM-720'),
        ['1 bill-of-materials line is filed under its number instead of its record — remove it in 3. BOM Engine first — by number, and no other record would carry it']);
    // A synced line names a component by NetSuite id when the component was not in the library yet.
    const byNs = plan(['CE-INV-900'], { pins: [{ id: 'pinX', assemblyId: 'CE-ASM-700', partId: '900' }] });
    eq('a line that names it by NetSuite id holds it', usesOf(byNs, 'CE-INV-900'), ['on the bill of materials of H1-1 — 1" master — by number, and no other record would carry it']);
}
// ── A DUPLICATE MAY GO: THE SURVIVOR ANSWERS FOR THE NUMBER ──────────────────────────────────────
{
    eq('one of two records with the brass number: the other still answers the twin tag', ids(plan(['CE-INV-201']).deletable), ['CE-INV-201']);
    eq('…either of them', ids(plan(['CE-INV-200']).deletable), ['CE-INV-200']);
    const both = plan(['CE-INV-200', 'CE-INV-201']);
    eq('both: neither may go — the tag would point at nothing', [ids(both.deletable), usesOf(both, 'CE-INV-200')],
        [[], ['H1-1BS — Basic Bracket names it as its BRASS twin — by number, and no other record would carry it']]);
    eq('both AND the standard part that names them — but the standard part is on a flow, so all three stay',
        ids(plan(['CE-INV-100', 'CE-INV-200', 'CE-INV-201']).deletable), []);
    const noFlow = plan(['CE-INV-100', 'CE-INV-200', 'CE-INV-201'], { flows: [] });
    eq('with no flow holding the standard part, the three go together', ids(noFlow.deletable), ['CE-INV-100', 'CE-INV-200', 'CE-INV-201']);
    // One duplicate held by record id (a BOM line), the other named only by number: the held one answers.
    const pins = [...PINS, { id: 'pin9', assemblyId: 'CE-ASM-720', partId: 'CE-INV-200' }];
    const held = plan(['CE-INV-200', 'CE-INV-201'], { pins });
    eq('a duplicate goes when the record that has to stay carries the number', [ids(held.deletable), ids(held.refused.map(r => r.part))], [['CE-INV-201'], ['CE-INV-200']]);
    eq('…and the one that stays says why', usesOf(held, 'CE-INV-200'), ['on the bill of materials of H1-1SUB — Sub-assembly']);
}
// ── HELD RECORDS HOLD OTHERS ─────────────────────────────────────────────────────────────────────
{
    const chain = plan(['KIT-1', 'CE-INV-500']);
    eq('the kit is on a flow, so it stays — and so does the component it lists', [ids(chain.deletable), usesOf(chain, 'KIT-1'), usesOf(chain, 'CE-INV-500')],
        [[], ['CPQ flow "H1-1 · 1" Metal" — Kits'], ['kit H1-1KIT — Bracket kit lists it as a component']]);
    eq('with no flow, kit and component go together', ids(plan(['KIT-1', 'CE-INV-500'], { flows: [] }).deletable), ['KIT-1', 'CE-INV-500']);
    eq('the kit alone goes too (its list goes with it)', ids(plan(['KIT-1'], { flows: [] }).deletable), ['KIT-1']);
}
// ── FINISH VARIANTS LEFT BEHIND ARE NAMED, NOT HELD ──────────────────────────────────────────────
{
    const v = plan(['CE-INV-100'], { flows: [] });
    eq('the base goes; its two finish variants are named', [ids(v.deletable), v.variantsLeft.map(x => [x.part.id, ids(x.variants)])], [['CE-INV-100'], [['CE-INV-100', ['CE-INV-101', 'CE-INV-102']]]]);
    eq('ticked with it, nothing is left to name', plan(['CE-INV-100', 'CE-INV-101', 'CE-INV-102'], { flows: [] }).variantsLeft, []);
    eq('a variant alone has no variants', plan(['CE-INV-101']).variantsLeft, []);
}
// ── THE SECOND LOOK, AND THE LEDGER COPY ─────────────────────────────────────────────────────────
{
    ok('the same answer twice', samePlan(plan(['TMP-1', 'CE-INV-300']), plan(['CE-INV-300', 'TMP-1'])));
    ok('a new use between the look and the delete is seen', !samePlan(plan(['TMP-1']), plan(['TMP-1'], { pins: [...PINS, { assemblyId: 'CE-ASM-720', partId: 'TMP-1' }] })));
    ok('a line added to an assembly that is going is seen too', !samePlan(plan(['CE-ASM-720']), plan(['CE-ASM-720'], { pins: [...PINS, { id: 'pinNew', assemblyId: 'CE-ASM-720', partId: 'CE-INV-500' }] })));
    const rec = ledgerRecordOf(BBS);
    eq('the ledger copy is the record, with its number where the ledger lists it', [rec.itemCode, rec.id, rec.itemName, rec.netSuiteInternalId], ['H1-1BBS', 'CE-INV-200', 'Brass Basic Bracket', '200']);
    eq('a record with no number is listed by its id', ledgerRecordOf(P1).itemCode, 'TMP-1');
    ok('the record handed in is not changed', !('itemCode' in BBS));
}
// ── WHAT ELSE IS KEYED TO THE RECORD ─────────────────────────────────────────────────────────────
{
    const r = residualsOf({
        parts: [BBS, BBS2, P1],
        diffIds: ['CE-INV-200', 'CE-INV-100'],
        retiredIds: [200, '201', 300, '999'],
        assets: [
            { id: 'a1', associatedParts: ['CE-INV-200', 'CE-INV-100'] },
            { id: 'a2', associatedParts: ['CE-INV-100'] },
            { id: 'a3', associatedParts: ['TMP-1'] },
            { id: 'a4' },
        ],
    });
    eq('only these records\' NetSuite-differs rows', r.diffIds, ['CE-INV-200']);
    eq('the locked OLD list loses these NetSuite ids — whatever type they were stored as — and keeps the rest as stored', r.retired, { next: [300, '999'], removed: [200, '201'] });
    eq('gallery pictures keep their other links; the picture stays', r.assets, [{ id: 'a1', associatedParts: ['CE-INV-100'] }, { id: 'a3', associatedParts: [] }]);
    const none = residualsOf({ parts: [P1], diffIds: [], retiredIds: [300], assets: [] });
    eq('nothing keyed to it: nothing touched, and the locked list is not rewritten', [none.diffIds, none.retired, none.assets], [[], null, []]);
    eq('a record with no NetSuite id never empties the list by matching blank', residualsOf({ parts: [P1], retiredIds: ['', 300] }).retired, null);
}

// ── ONE BATCH AT A TIME ──────────────────────────────────────────────────────────────────────────
{
    const many = Array.from({ length: 300 }, (_, i) => item(`X-${i}`, `X${i}`, 'x'));
    const chunks = deleteChunks(many, []);
    ok('every record is in exactly one group, in order', chunks.flat().map(p => p.id).join() === many.map(p => p.id).join());
    ok('no group is more than a batch holds', chunks.every(c => c.length * 3 + 1 <= 400) && chunks.length === 3);
    const pics = Array.from({ length: 396 }, (_, i) => ({ id: `pic${i}`, associatedParts: ['X-0'] }));
    eq('a record linked from many pictures takes its own room', deleteChunks(many.slice(0, 3), pics).map(c => c.length), [1, 2]);
    eq('big records are split by size', deleteChunks([{ id: 'a', blob: 'x'.repeat(900) }, { id: 'b', blob: 'x'.repeat(900) }, { id: 'c' }], [], { maxBytes: 1000 }).map(c => c.map(p => p.id)), [['a'], ['b', 'c']]);
    const lines = { 'X-0': Array.from({ length: 394 }, (_, i) => ({ id: `l${i}` })) };
    eq('an assembly with a long bill of materials takes its own room', deleteChunks(many.slice(0, 3), [], { lines }).map(c => c.length), [1, 2]);
    eq('nothing in, nothing out', deleteChunks([], []), []);
}

// ── THE WRITER: LEDGER COPY, DELETE AND EVERYTHING KEYED TO THE RECORD — ONE BATCH ───────────────
{
    // A stand-in database: a batch applies all of its writes on commit, or none.
    const fakeDb = (seed, { failOnCommit = 0 } = {}) => {
        const data = new Map(Object.entries(seed));
        let commits = 0;
        const doc = (_db, ...path) => path.join('/');
        const writeBatch = () => {
            const ops = [];
            return {
                set: (ref, v) => { ops.push(['set', ref, v]); },
                update: (ref, v) => { ops.push(['update', ref, v]); },
                delete: (ref) => { ops.push(['delete', ref]); },
                commit: async () => {
                    commits++;
                    if (commits === failOnCommit) throw new Error('the database said no');
                    ops.forEach(([op, ref, v]) => {
                        if (op === 'delete') data.delete(ref);
                        else if (op === 'set') data.set(ref, v);
                        else { if (!data.has(ref)) throw new Error(`no document to update: ${ref}`); data.set(ref, { ...data.get(ref), ...v }); }
                    });
                },
            };
        };
        return { data, ctx: { db: {}, doc, writeBatch, recordDeletion }, commits: () => commits };
    };
    const seed = () => ({
        'Approved_Designs/CE-INV-200': BBS, 'Approved_Designs/CE-INV-201': BBS2, 'Approved_Designs/CE-INV-100': BS, 'Approved_Designs/TMP-1': P1,
        'system/ns_import_diffs/items/CE-INV-200': { fields: { basePrice: { app: 35, ns: 30 } }, dismissed: { stockUnit: 'EA' } },
        'system/ns_import_diffs/items/CE-INV-100': { fields: {} },
        'system/retired_items': { internalIds: [200, '201', 300], lockedBy: 'Stuart' },
        'global_assets/a1': { name: 'brass.jpg', associatedParts: ['CE-INV-200', 'CE-INV-100'] },
        'global_assets/a2': { name: 'steel.jpg', associatedParts: ['CE-INV-100'] },
    });
    const storeOf = (data) => ({
        diffIds: [...data.keys()].filter(k => k.startsWith('system/ns_import_diffs/items/')).map(k => k.split('/').pop()),
        retiredIds: data.get('system/retired_items').internalIds,
        assets: [...data.entries()].filter(([k]) => k.startsWith('global_assets/')).map(([k, v]) => ({ id: k.split('/').pop(), associatedParts: v.associatedParts })),
    });

    const f = fakeDb(seed());
    const seen = [];
    const done = await applyItemDelete(f.ctx, { parts: [BBS, BBS2, P1], store: storeOf(f.data), by: 'Stuart', reason: 'loaded twice', onProgress: (n, of) => seen.push(`${n}/${of}`) });
    eq('three records deleted, nothing failed', [ids(done.deleted), done.lines, done.failed, seen], [['CE-INV-200', 'CE-INV-201', 'TMP-1'], 0, '', ['3/3']]);
    eq('the records are gone; the one not asked for is there', ['CE-INV-200', 'CE-INV-201', 'TMP-1', 'CE-INV-100'].map(id => f.data.has(`Approved_Designs/${id}`)), [false, false, false, true]);
    eq('its NetSuite-differs record went with it — the remembered "keep the app\'s" too; another item\'s stays',
        [f.data.has('system/ns_import_diffs/items/CE-INV-200'), f.data.has('system/ns_import_diffs/items/CE-INV-100')], [false, true]);
    eq('the locked OLD list lost those two NetSuite ids and kept everything else on the document', f.data.get('system/retired_items'), { internalIds: [300], lockedBy: 'Stuart' });
    eq('the gallery picture lost its link to the deleted record only; the picture and its other link stay', [f.data.get('global_assets/a1'), f.data.get('global_assets/a2')],
        [{ name: 'brass.jpg', associatedParts: ['CE-INV-100'] }, { name: 'steel.jpg', associatedParts: ['CE-INV-100'] }]);
    const ledger = [...f.data.entries()].filter(([k]) => k.startsWith(`${DELETION_LEDGER}/`)).map(([, v]) => v);
    eq('one ledger entry a record, written by the one ledger writer', ledger.map(e => [e.collection, e.docId, e.mode, e.kind, e.by, e.from, e.identity.itemCode, e.reason]).sort(), [
        ['Approved_Designs', 'CE-INV-200', 'HARD', 'LIBRARY_ITEM', 'Stuart', 'LIBRARY_TRUE_DELETE', 'H1-1BBS', 'Brass Basic Bracket · loaded twice'],
        ['Approved_Designs', 'CE-INV-201', 'HARD', 'LIBRARY_ITEM', 'Stuart', 'LIBRARY_TRUE_DELETE', 'H1-1BBS', 'Brass Basic Bracket (duplicate) · loaded twice'],
        ['Approved_Designs', 'TMP-1', 'HARD', 'LIBRARY_ITEM', 'Stuart', 'LIBRARY_TRUE_DELETE', 'TMP-1', 'Draft one · loaded twice'],
    ]);
    eq('…holding the copy of the record', ledger.find(e => e.docId === 'CE-INV-200').record.itemName, 'Brass Basic Bracket');
    ok('all of it in ONE commit', f.commits() === 1);

    // An assembly: its own lines go in the same commit, with one ledger entry holding them.
    const a = fakeDb({ 'Approved_Designs/CE-ASM-720': SUB, 'Approved_Designs/CE-INV-900': JUNK, 'assembly_pins/pin2': PINS[1], 'assembly_pins/pin3': PINS[2], 'assembly_pins/pin1': PINS[0],
        'system/retired_items': { internalIds: [] } });
    const subPlan = plan(['CE-ASM-720']);
    const asmRun = await applyItemDelete(a.ctx, { parts: subPlan.deletable, lines: subPlan.lines, store: { diffIds: [], retiredIds: [], assets: [] }, by: 'Stuart' });
    eq('the assembly and its two lines are gone; another assembly\'s line and the part are not', [ids(asmRun.deleted), asmRun.lines, asmRun.failed,
        ['Approved_Designs/CE-ASM-720', 'assembly_pins/pin2', 'assembly_pins/pin3', 'assembly_pins/pin1', 'Approved_Designs/CE-INV-900'].map(k => a.data.has(k))],
        [['CE-ASM-720'], 2, '', [false, false, false, true, true]]);
    const asmLedger = [...a.data.entries()].filter(([k]) => k.startsWith(`${DELETION_LEDGER}/`)).map(([, v]) => v);
    eq('two ledger entries: the assembly, and its lines', asmLedger.map(e => [e.collection, e.docId, e.kind, e.identity.itemCode]).sort(),
        [['Approved_Designs', 'CE-ASM-720', 'LIBRARY_ITEM', 'H1-1SUB'], ['assembly_pins', 'CE-ASM-720 · 2 lines', 'LIBRARY_BOM_LINES', 'H1-1SUB']]);
    eq('…the lines entry holds the lines', asmLedger.find(e => e.kind === 'LIBRARY_BOM_LINES').record.lines.map(l => [l.id, l.partId]), [['pin2', 'h1-1zz'], ['pin3', 'PENDING']]);
    ok('one commit', a.commits() === 1);

    // The database refuses: nothing of that group happened — no delete, and no ledger entry for a delete that did not happen.
    const g = fakeDb(seed(), { failOnCommit: 1 });
    const refusedRun = await applyItemDelete(g.ctx, { parts: [BBS, P1], store: storeOf(g.data), by: 'Stuart' });
    eq('a refused commit deletes nothing and says why', [ids(refusedRun.deleted), refusedRun.failed], [[], 'the database said no']);
    ok('…the records, the differs record, the list and the picture are as they were', JSON.stringify([...g.data.entries()]) === JSON.stringify(Object.entries(seed())));

    // Two groups, the second refused: the first stays done, the second is whole.
    const many = Array.from({ length: 150 }, (_, i) => item(`X-${i}`, `X${i}`, 'x', { netSuiteInternalId: String(1000 + i) }));
    const big = { 'system/retired_items': { internalIds: many.map(p => p.netSuiteInternalId).concat(['7']) } };
    many.forEach(p => { big[`Approved_Designs/${p.id}`] = p; });
    const h = fakeDb(big, { failOnCommit: 2 });
    const part = await applyItemDelete(h.ctx, { parts: many, store: { diffIds: [], retiredIds: big['system/retired_items'].internalIds, assets: [] }, by: 'Stuart' });
    const firstGroup = deleteChunks(many, [])[0].length;
    eq('it stops at the group that failed', [part.deleted.length, part.failed], [firstGroup, 'the database said no']);
    eq('the first group is gone, the rest untouched', [many.filter(p => h.data.has(`Approved_Designs/${p.id}`)).length, h.data.get('system/retired_items').internalIds.length], [150 - firstGroup, 150 - firstGroup + 1]);
    const all2 = fakeDb(big);
    const whole = await applyItemDelete(all2.ctx, { parts: many, store: { diffIds: [], retiredIds: big['system/retired_items'].internalIds, assets: [] }, by: 'Stuart' });
    eq('across two groups the locked list ends with only what was never ours', [whole.deleted.length, all2.data.get('system/retired_items').internalIds, all2.commits()], [150, ['7'], 2]);
}

console.log(`${fail ? '✗' : '✓'} itemDelete: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
