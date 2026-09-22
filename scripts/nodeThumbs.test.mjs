// Harness for nodeThumbs — photographing ONE component out of the assembly, without touching 1.6.
//
//   node scripts/nodeThumbs.test.mjs
//
// The matcher is the whole risk. It decides which node in the model IS a given part, and if it is
// wrong the part gets a confident picture of something else — a failure nobody spots on a quote,
// only in a box. So the cases here are mostly about refusing rather than matching: a code with no
// node, and two different records whose codes reduce to the same key.

import {
    cleanFusionName, nodeKey, baseCodeOf, buildNodeIndex, planNodeThumbs, nodeThumbSummary, nodeThumbPlanText,
    NODE_READY, NODE_NONE, NODE_AMBIGUOUS, NODE_NO_CODE, NODE_HAS_PHOTO,
} from '../src/components/Shared/nodeThumbs.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── THE NAME RULES (moved here from fusionImport so they can be tested at all) ────────────────
eq('Fusion version noise is stripped', cleanFusionName('H1-75BE v3:2'), 'H1-75BE');
eq('…and the FBX-sanitised spelling of it', cleanFusionName('H1-75BE_v32'), 'H1-75BE');
eq('…and an instance suffix', cleanFusionName('H1-2TRVBP:1'), 'H1-2TRVBP');
eq('…and an exporter ordinal', cleanFusionName('Body1.048'), 'Body1');
eq('a clean name is left alone', cleanFusionName('H1-2TRVBP'), 'H1-2TRVBP');
eq('the key is alphanumeric only', nodeKey('H1-2TRV BP:2'), 'h12trvbp');
// ⚠ NOT the same rule as componentExport's `sanitize`, deliberately. That one keeps the digits
// ("Body1.048" → "body1048") because it matches raw mesh names against names already STORED on
// clusters. This one matches against ITEM CODES, which never carry a placement ordinal — so the
// ordinal has to go, or "H1-2TRVBP.001" would match nothing at all.
eq('a placement ordinal is stripped, so the second copy still finds its code',
    nodeKey('H1-2TRVBP.001'), nodeKey('H1-2TRVBP'));

// ── THE FINISH DOES NOT CHANGE THE GEOMETRY ──────────────────────────────────────────────────
eq('a /P part is the base node', baseCodeOf({ legacyErpId: 'H1-2TRVBP/P' }), 'H1-2TRVBP');
eq('an /EP part too', baseCodeOf({ legacyErpId: 'H1-2TRVLA/EP1' }), 'H1-2TRVLA');
eq('a mill part is itself', baseCodeOf({ legacyErpId: 'H1-2TRVBP' }), 'H1-2TRVBP');
eq('itemId is used when there is no legacy code', baseCodeOf({ itemId: 'H1-2TRVBA6' }), 'H1-2TRVBA6');
eq('a record with no code at all', baseCodeOf({}), '');

// ── THE INDEX ────────────────────────────────────────────────────────────────────────────────
{
    const ix = buildNodeIndex(['H1-2TRVBP', 'H1-2TRVBP:2', 'H1-2TRVLA', '', 'Body1.048']);
    eq('the same component placed twice is one key, two names', ix.get('h12trvbp').length, 2);
    eq('a distinct component is its own key', ix.get('h12trvla'), ['H1-2TRVLA']);
    ok('an unnamed node is ignored', !ix.get(''));
}

// ── THE PLAN ─────────────────────────────────────────────────────────────────────────────────
{
    const nodes = ['H1-2TRV-WB', 'H1-2TRVBP', 'H1-2TRVBP:2', 'H1-2TRVLA v2:1', 'H1-2TRVBA', 'H1-2TRVNUT'];
    const parts = [
        { id: 'p1', legacyErpId: 'H1-2TRVBP/P', itemName: 'Backplate' },
        { id: 'p2', legacyErpId: 'H1-2TRVLA/P', itemName: 'L arm' },
        { id: 'p3', legacyErpId: 'H1-2TRVBA/P', itemName: 'Arm 3.995' },
        { id: 'p4', legacyErpId: 'H1-2TRVFH/P', itemName: 'Not in this model' },
    ];
    const rows = planNodeThumbs({ parts, nodeNames: nodes });

    eq('the three that are in the model are READY', rows.slice(0, 3).map(r => r.status), Array(3).fill(NODE_READY));
    // The RAW name, not the cleaned key — `belongs()` compares against the node's actual name, so
    // handing it the tidied spelling would match nothing.
    eq('each resolves to the raw node name, which is what the renderer matches on',
        rows.slice(0, 3).map(r => r.node), ['H1-2TRVBP', 'H1-2TRVLA v2:1', 'H1-2TRVBA']);
    eq('a component placed twice reports both but photographs one', rows[0].instances, 2);
    eq('a part with no node is named, not guessed at', rows[3].status, NODE_NONE);
    ok('…and says which model it is missing from', /no node named H1-2TRVFH/.test(rows[3].why));

    // ⚠ TWO PARTS, ONE KEY — the dangerous case: each would take the other's picture.
    const clash = planNodeThumbs({
        parts: [{ id: 'a', legacyErpId: 'H1-2TRV-WB' }, { id: 'b', legacyErpId: 'H1-2TRVWB' }],
        nodeNames: ['H1-2TRV-WB'],
    });
    eq('both records are refused, not one picked', clash.map(r => r.status), [NODE_AMBIGUOUS, NODE_AMBIGUOUS]);
    ok('…naming both', /H1-2TRV-WB and H1-2TRVWB/.test(clash[0].why));

    // A real photograph is left alone (the rule every picture writer follows).
    const photo = planNodeThumbs({ parts: [parts[0]], nodeNames: nodes, hasPhoto: () => true });
    eq('a photographed part is skipped', photo[0].status, NODE_HAS_PHOTO);

    eq('a record with no code is refused', planNodeThumbs({ parts: [{ id: 'x' }], nodeNames: nodes })[0].status, NODE_NO_CODE);

    // Nothing dropped on the floor.
    eq('one row per part', rows.length, 4);
    eq('summary counts them', nodeThumbSummary(rows), { [NODE_READY]: 3, [NODE_NONE]: 1 });
    const text = nodeThumbPlanText(rows, 'H1-2TRV');
    ok('the plan names the assembly', /^H1-2TRV:/.test(text));
    ok('and what will be photographed, with the node', /H1-2TRVBP → node "H1-2TRVBP"/.test(text));
    ok('and what is not in this model', /1 not in this model: H1-2TRVFH/.test(text));
    ok('an empty model says so rather than looking successful',
        /nothing to photograph here/.test(nodeThumbPlanText(planNodeThumbs({ parts, nodeNames: [] }), 'EMPTY')));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
