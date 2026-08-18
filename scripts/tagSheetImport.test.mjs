import { parseTagRows, planTagImport, applyTagPlan, nodeKey } from '../src/components/Shared/tagSheetImport.js';
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.error('  ✗',n); } };
const eq=(n,a,b)=>{ if(JSON.stringify(a)===JSON.stringify(b)) pass++; else { fail++; console.error('  ✗',n,'\n    got ',JSON.stringify(a),'\n    want',JSON.stringify(b)); } };

const HEAD=['SLOT','SLOT FILE (.fbx)','CAT','POSITION','NODE NAME','ITEM ID','ROD','PROJ','SETUP','TRV','MOUNT','MADE IN','BASIC','INL-BKT','FEE','HIDE','ALWAYS','COLLAR','NOTES'];
const row=(o={})=>HEAD.map(h=>o[h]??'');

// ── the real shapes from the H1-138 sheet ────────────────────────────────────────────────────
const rows=[HEAD,
  row({'SLOT':'METAL POLE DBL BACK LEFT','SLOT FILE (.fbx)':'a.fbx','CAT':'POLE','NODE NAME':'H1-138inPOLE DBL Back left:1',
       'ITEM ID':'H1-138R','ROD':'BACK','PROJ':'FRONT:6.5, BACK:3.25','SETUP':'DOUBLE','MADE IN':'METAL'}),
  row({'SLOT':'Dec DBL Bracket Center','SLOT FILE (.fbx)':'b.fbx','CAT':'BRACKET','POSITION':'CENTER','NODE NAME':'H1-138DD:1',
       'ITEM ID':'H1-138D','PROJ':'FRONT:8.5, BACK:3.25','SETUP':'DOUBLE','MADE IN':'METAL','BASIC':'Y'}),
  row({'SLOT':'TRAV DBL Bracket Center','SLOT FILE (.fbx)':'c.fbx','CAT':'BRACKET','POSITION':'CENTER','NODE NAME':'H1-138TRVDBA:1',
       'ITEM ID':'H1-138TRVDBA','PROJ':'FRONT:6.5, BACK:3.25','SETUP':'DOUBLE','TRV':'TRV_BRACKET'}),
  row({'SLOT':'ACRYLIC POLE DBL BACK','SLOT FILE (.fbx)':'d.fbx','CAT':'POLE','NODE NAME':'H1-138AR DBL BACK',
       'ITEM ID':'H1-138AR','ROD':'BACK','MADE IN':'CLEAR (NO FINISH)'}),
  row({'SLOT':'POLE FR-MTR DBL Back','SLOT FILE (.fbx)':'e.fbx','CAT':'CARRIER','NODE NAME':'H1-138STDOFF:1',
       'ITEM ID':'H1-138STDOFF','ROD':'BACK','ALWAYS':'Y'}),
];
const { patches, slots, warnings } = parseTagRows(rows);
eq('every row parsed', patches.size, 5);
eq('slots grouped', slots.length, 5);
eq('no warnings', warnings, []);

const pole=patches.get(nodeKey('H1-138inPOLE DBL Back left:1'));
eq('item id', pole.itemNo, 'H1-138R');
eq('tier', pole.tier, 'BACK');
eq('the depth pair survives verbatim', pole.projInches, 'FRONT:6.5, BACK:3.25');
eq('setup', pole.trvSetup, 'DOUBLE');
eq('material', pole.materials, 'METAL');
ok('a pole is not flagged basic', !pole.isBasic);

const acr=patches.get(nodeKey('H1-138AR DBL BACK'));
eq('CLEAR is stored as a material', acr.materials, 'CLEAR');
ok('…and sets noFinish, so the sheet says it once', acr.noFinish === true);

const trv=patches.get(nodeKey('H1-138TRVDBA:1'));
eq('traverse-only bracket', trv.traverseRole, 'TRV_BRACKET');
const bkt=patches.get(nodeKey('H1-138DD:1'));
ok('BASIC is read', bkt.isBasic === true);
const std=patches.get(nodeKey('H1-138STDOFF:1'));
ok('ALWAYS is read', std.alwaysShown === true);
eq('CARRIER becomes a traverse role, not a category', [std.catOverride, std.traverseRole], ['', 'CARRIER']);

// ── planning against what 1.6 actually holds ─────────────────────────────────────────────────
const loaded=[{ clusterId:'c1', clusterName:'REAR POLE', choices:[
    { nodeName:'H1-138inPOLE DBL Back left:1', itemNo:'', tier:'', projInches:'', isBasic:false },
    { nodeName:'A NODE NOBODY TAGGED', itemNo:'', tier:'' },
]}];
const plan=planTagImport(rows, loaded);
eq('one node matched', plan.hits.length, 1);
eq('and it changes', plan.changed.length, 1);
ok('the diff names the fields', plan.hits[0].diff.some(d=>d.field==='tier' && d.to==='BACK'));
eq('rows matching no geometry are reported', plan.unmatchedRows.length, 4);
eq('geometry with no row is reported', plan.untagged.length, 1);
eq('…by name', plan.untagged[0].node, 'A NODE NOBODY TAGGED');

// ── applying, and re-applying ────────────────────────────────────────────────────────────────
const after=applyTagPlan(loaded, plan);
eq('the tag landed', after[0].choices[0].tier, 'BACK');
eq('the pair landed', after[0].choices[0].projInches, 'FRONT:6.5, BACK:3.25');
eq('the untagged choice is untouched', after[0].choices[1].nodeName, 'A NODE NOBODY TAGGED');
ok('nothing was invented for it', !after[0].choices[1].projInches);
const plan2=planTagImport(rows, after);
eq('re-importing the same sheet changes nothing', plan2.changed.length, 0);

// ── the things that go wrong ─────────────────────────────────────────────────────────────────
const dup=[HEAD, row({'NODE NAME':'X:1','ITEM ID':'A'}), row({'NODE NAME':'x:1','ITEM ID':'B'})];
const d=parseTagRows(dup);
eq('a repeated node is caught', d.patches.size, 1);
ok('and said out loud', d.warnings.some(w=>/more than once/.test(w)));
eq('the first wins', d.patches.get(nodeKey('X:1')).itemNo, 'A');

const notASheet=parseTagRows([['A','B'],['1','2']]);
ok('a file that is not a tagging sheet is refused', /not a tagging sheet/.test(notASheet.warnings[0]));

// A blank cell leaves what is on screen; it never wipes it.
const loaded2=[{ clusterId:'c1', clusterName:'X', choices:[{ nodeName:'H1-138AR DBL BACK', itemNo:'H1-138AR', mountType:'CEILING' }]}];
const after2=applyTagPlan(loaded2, planTagImport(rows, loaded2));
eq('a blank cell does not clear an existing value', after2[0].choices[0].mountType, 'CEILING');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail?1:0);
