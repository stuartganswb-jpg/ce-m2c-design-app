// Harness for nodeThumbs — photographing ONE component out of the assembly, without touching 1.6.
//
//   node scripts/nodeThumbs.test.mjs
//
// The matcher is the whole risk. It decides which node in the model IS a given part, and if it is
// wrong the part gets a confident picture of something else — a failure nobody spots on a quote,
// only in a box. So the cases here are mostly about refusing rather than matching: a code with no
// node, and two different records whose codes reduce to the same key.

import {
    cleanFusionName, nodeKey, baseCodeOf, buildNodeIndex, planNodeThumbs, nodeThumbSummary, nodeThumbPlanText, planModelThumbs, modelReportText, slotTailOf,
    slotReportText, NODE_READY, NODE_NONE, NODE_AMBIGUOUS, NODE_NO_CODE, NODE_HAS_PHOTO,
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

// ── WHAT A TAGGED SLOT CONTAINS — the report that matters when nothing matches ───────────────
// The kit's own picture renders fine, so the model and the pin are good; if the COMPONENTS match
// nothing, the only useful output is the names that ARE in there. A slot that quietly reports
// "0 matched" teaches nobody anything.
{
    const parts = [{ id: 'p1', legacyErpId: 'H1-2TRVLA/P' }, { id: 'p2', legacyErpId: 'H1-2TRVBP/P' }];
    const children = [
        { name: 'Lower Arm', depth: 1, isMesh: false, meshes: 3 },
        { name: 'Body1', depth: 2, isMesh: true, meshes: 1 },
        { name: 'EmptyGroup', depth: 1, isMesh: false, meshes: 0 },
    ];
    const rows = planNodeThumbs({ parts, nodeNames: children.map(c => c.name) });
    const text = slotReportText('H1-2TRV-6WB', rows, children);
    ok('the slot is named with how many nodes are inside it', /H1-2TRV-6WB — 3 node\(s\) inside/.test(text));
    ok('the components that matched nothing are named', /no node matched: H1-2TRVLA, H1-2TRVBP/.test(text));
    ok('and the names actually in there are printed, so the naming is visible',
        /inside it: .*Lower Arm.*Body1/.test(text));
    ok('a node with no geometry is not offered as a candidate', !/EmptyGroup/.test(text));

    // ⚠ THE TWO WAYS OF FINDING NOTHING, which must never read the same. A pin whose node is not in
    // the model is a TAGGING problem; a node with nothing under it is a GEOMETRY one. Reporting the
    // first as the second sends someone off to redraw parts that are sitting in the file.
    const solid = slotReportText('H1-2TRV-WB', planNodeThumbs({ parts, nodeNames: [] }), [], 14, true);
    ok('an empty node says the solid really is welded', /really is one welded solid/.test(solid));
    const absent = slotReportText('H1-2TRV-WB', planNodeThumbs({ parts, nodeNames: [] }), [], 14, false);
    ok('a node that is not in the model says THAT instead', /NOT in this model/.test(absent));
    ok('…and points at the pin, not the geometry', /pin and the GLB disagree/.test(absent));
    ok('…and never calls it a solid', !/welded solid/.test(absent));

    // When it works, the matched pairs are shown with the node each resolved to.
    const good = planNodeThumbs({ parts, nodeNames: ['H1-2TRVLA', 'H1-2TRVBP'] });
    const gt = slotReportText('H1-2TRV-6WB', good, [
        { name: 'H1-2TRVLA', depth: 1, isMesh: true, meshes: 1 },
        { name: 'H1-2TRVBP', depth: 1, isMesh: true, meshes: 1 }]);
    ok('a working slot shows each match and its node', /H1-2TRVLA → "H1-2TRVLA"/.test(gt));
    ok('…and reports no misses', !/no node matched/.test(gt));
    // Long slots are trimmed for the dialog, and say that they were.
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Part${i}`, depth: 1, isMesh: true, meshes: 1 }));
    ok('a crowded slot is trimmed and says how many more',
        /and 16 more/.test(slotReportText('X', planNodeThumbs({ parts, nodeNames: [] }), many)));
}


// ── A WHOLE PARTS MODEL, BY NAME (2026-09-23) — the designer's export, planned against the library ──
{
    const lib = [
        { id: 'bp', legacyErpId: 'H1-2TRVBP' },
        { id: 'la', legacyErpId: 'H1-2TRVLA' },
        { id: 'nut', legacyErpId: 'H1-2TRVNUT' },
        { id: 'arm', legacyErpId: 'H1-2TRVBADBL', finalImageUrl: 'https://x/arm.png', imageSource: 'DRAWING' },
        { id: 'gal', legacyErpId: 'H1-2TRVCLP', finalImageUrl: 'https://x/clp.jpg', imageSource: 'GALLERY' },
        { id: 'c1', legacyErpId: 'H1-75BE' }, { id: 'c2', legacyErpId: 'H1-75-BE' },
        { id: 'elsewhere', legacyErpId: 'H1-138WEC' },
    ];
    const nodes = ['Scene', 'H1-2TRVBP v3:1', 'H1-2TRVLA_v2', 'H1-2TRVNUT:1', 'H1-2TRVNUT:2', 'H1-2TRVBADBL', 'H1-2TRVCLP', 'H1-75BE v1', 'Body1', 'Component7'];
    const photo = (p) => p.imageSource === 'GALLERY';
    const rows = planModelThumbs({ parts: lib, nodeNames: nodes, hasPhoto: photo });
    const st = Object.fromEntries(rows.map(r => [r.code, r.status]));
    eq('every part named in the model is planned; a part the model does not hold is not an error, it is absent',
        Object.keys(st).sort(), ['H1-2TRVBADBL', 'H1-2TRVBP', 'H1-2TRVCLP', 'H1-2TRVLA', 'H1-2TRVNUT', 'H1-75-BE', 'H1-75BE']);
    eq('version noise and instance suffixes still match', [st['H1-2TRVBP'], st['H1-2TRVLA'], st['H1-2TRVNUT']], ['READY', 'READY', 'READY']);
    eq('a second instance is counted, the first (sorted) is photographed', rows.find(r => r.code === 'H1-2TRVNUT').instances, 2);
    eq('a drawing cut may be replaced by a real render', st['H1-2TRVBADBL'], 'READY');
    eq('a gallery photograph is never replaced', st['H1-2TRVCLP'], 'HAS_PHOTO');
    eq('two records reducing to one node name are refused, both of them', [st['H1-75BE'], st['H1-75-BE']], ['AMBIGUOUS_CODE', 'AMBIGUOUS_CODE']);
    ok('the refusal names both records', (() => { const w = rows.find(r => r.code === 'H1-75BE').why; return /H1-75BE/.test(w) && /H1-75-BE/.test(w) && / and /.test(w); })());
    eq('Body1 and Component7 match nothing and are not planned', rows.some(r => /body|component/i.test(r.code)), false);
    // A FINISH FAMILY IS ONE PART (2026-09-23: 110 refusals, every base against its own /B /C /EP1 … /P25).
    const fam = [
        { id: 'ba', legacyErpId: 'H1-2TRVBA' }, { id: 'ba-b', legacyErpId: 'H1-2TRVBA/B' }, { id: 'ba-ep1', legacyErpId: 'H1-2TRVBA/EP1' }, { id: 'ba-p25', legacyErpId: 'H1-2TRVBA/P25' },
        { id: 'fh-p', legacyErpId: 'H1-2TRVFH/P' }, { id: 'fh-ep2', legacyErpId: 'H1-2TRVFH/EP2' },        // variants only, no base record
    ];
    const frows = planModelThumbs({ parts: fam, nodeNames: ['S0ZG584-NEW-SLOT__4_H12TRVBA', 'S0ZG584-NEW-SLOT__1_H12TRVFH'] });
    eq('the base record is photographed once; its finish variants are never rivals and are left to the inheritance pass',
        frows.filter(r => r.code === 'H1-2TRVBA').map(r => [r.part.id, r.status]), [['ba', 'READY']]);
    eq('a family with no base record has each variant photographed itself, so none is left blank',
        frows.filter(r => /^H1-2TRVFH\//.test(r.code)).map(r => r.part.id).sort(), ['fh-ep2', 'fh-p']);
    eq('…and the raw merged node goes to the renderer for both', frows.filter(r => /^H1-2TRVFH\//.test(r.code)).every(r => r.node === 'S0ZG584-NEW-SLOT__1_H12TRVFH'), true);
    // THE NODE CARRIES THE FINISH (2026-09-23, H1-BACKPLATES: H1BPWP4P is H1-BPWP4/P, and it did not match).
    const plates = [
        { id: 'bp4', legacyErpId: 'H1-BPWP4' }, { id: 'bp4-p', legacyErpId: 'H1-BPWP4/P' }, { id: 'bp4-ep1', legacyErpId: 'H1-BPWP4/EP1' },   // base present
        { id: 'cp6-p', legacyErpId: 'H1-CPWP6/P' }, { id: 'cp6-ep2', legacyErpId: 'H1-CPWP6/EP2' },                                       // variants only
        { id: 'sbpr', legacyErpId: 'H1-75SBP-R' },
    ];
    const pnodes = ['slot_1790099113522__0_H1BPWP4P', 'slot_1790099113522__1_H1CPWP6P', 'slot_1790099113522__2_H175SBPR'];
    const prows = planModelThumbs({ parts: plates, nodeNames: pnodes });
    eq('a node named with the finish still finds its family, and the BASE record takes the picture', prows.filter(r => /BPWP4/.test(r.code)).map(r => [r.part.id, r.node]), [['bp4', 'slot_1790099113522__0_H1BPWP4P']]);
    eq('…with no base record, every variant of the family is photographed from that node, under its own code',
        prows.filter(r => /CPWP6/.test(r.code)).map(r => [r.code, r.part.id, r.node]).sort(), [['H1-CPWP6/EP2', 'cp6-ep2', 'slot_1790099113522__1_H1CPWP6P'], ['H1-CPWP6/P', 'cp6-p', 'slot_1790099113522__1_H1CPWP6P']]);
    eq('a dash that is not a finish (H1-75SBP-R) matches as before', prows.find(r => r.code === 'H1-75SBP-R').node, 'slot_1790099113522__2_H175SBPR');
    const text = modelReportText('H1-2TRV BRACKET PARTS', rows, nodes);
    ok('the report counts what it will and will not do', /H1-2TRV BRACKET PARTS: 4 to photograph, 1 already photographed, 2 refused/.test(text));
    ok('…and names the refusals', /✗ H1-75BE: /.test(text));
    const empty = modelReportText('H1-BACKPLATES', planModelThumbs({ parts: lib, nodeNames: ['Scene', 'Body1', 'Mirror of Bracket v2'] }), ['Scene', 'Body1', 'Mirror of Bracket v2']);
    ok('a model whose nodes carry no item code prints the names it holds, cleaned', /no node in this model is named with an item code — it holds: Body1, Mirror of Bracket, Scene/.test(empty));
    eq('a model with no named nodes says so', /no named nodes at all/.test(modelReportText('X', [], [])), true);

    // THE MERGED MODEL'S SLOT PREFIX (2026-09-23, H1-2TRV BRACKET PARTS: "Nothing to photograph" while
    // every part sat there as S0ZG584-NEW-SLOT__9_H12TRVLA).
    eq('the tail behind the slot prefix, as 1.6 / CPQ / Admin read it', [slotTailOf('S0ZG584-NEW-SLOT__9_H12TRVLA'), slotTailOf('S0ZG584-NEW-SLOT__0_FusionImport'), slotTailOf('H12TRVLA')], ['H12TRVLA', 'FusionImport', 'H12TRVLA']);
    const merged = ['S0ZG584-NEW-SLOT', 'S0ZG584-NEW-SLOT__0_FusionImport', 'S0ZG584-NEW-SLOT__1_H12TRVFH', 'S0ZG584-NEW-SLOT__2_H12TRVBADBL', 'S0ZG584-NEW-SLOT__3_H12TRVBP', 'S0ZG584-NEW-SLOT__6_H12TRV', 'S0ZG584-NEW-SLOT__8_H12TRV2', 'S0ZG584-NEW-SLOT__9_H12TRVLA', 'S0ZG584-NEW-SLOT__10_H12TRVBADBL2'];
    const mrows = planModelThumbs({ parts: [...lib, { id: 'trv', legacyErpId: 'H1-2TRV' }], nodeNames: merged, hasPhoto: photo });
    const mst = Object.fromEntries(mrows.map(r => [r.code, r]));
    eq('every part behind a slot prefix is found, hyphen or not', Object.keys(mst).sort(), ['H1-2TRV', 'H1-2TRVBADBL', 'H1-2TRVBP', 'H1-2TRVLA']);
    eq('…and the RAW node name is what goes to the renderer', mst['H1-2TRVLA'].node, 'S0ZG584-NEW-SLOT__9_H12TRVLA');
    eq('H1-2TRV is found by its first instance; the designer-numbered H12TRV2 is a different name and adds nothing', [mst['H1-2TRV'].node, mst['H1-2TRV'].instances], ['S0ZG584-NEW-SLOT__6_H12TRV', 1]);
    eq('the slot node itself and the import root never match a part', mrows.some(r => /SLOT$|FusionImport/.test(r.node)), false);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
