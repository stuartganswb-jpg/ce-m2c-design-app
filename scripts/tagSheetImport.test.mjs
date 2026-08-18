import { parseTagRows, planTagImport, applyTagPlan, nodeKey, nodeTail, slotsFromSheet, matchSlotFiles } from '../src/components/Shared/tagSheetImport.js';
let pass=0, fail=0;
const ok=(n,c)=>{ if(c) pass++; else { fail++; console.error('  ✗',n); } };
const eq=(n,a,b)=>{ if(JSON.stringify(a)===JSON.stringify(b)) pass++; else { fail++; console.error('  ✗',n,'\n    got ',JSON.stringify(a),'\n    want',JSON.stringify(b)); } };

const find=(m,node)=>[...m.values()].find(p=>nodeKey(p.__node)===nodeKey(node));
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

const pole=find(patches, 'H1-138inPOLE DBL Back left:1');
eq('item id', pole.itemNo, 'H1-138R');
eq('tier', pole.tier, 'BACK');
eq('the depth pair survives verbatim', pole.projInches, 'FRONT:6.5, BACK:3.25');
eq('setup', pole.trvSetup, 'DOUBLE');
eq('material', pole.materials, 'METAL');
ok('a pole is not flagged basic', !pole.isBasic);

const acr=find(patches, 'H1-138AR DBL BACK');
eq('CLEAR is stored as a material', acr.materials, 'CLEAR');
ok('…and sets noFinish, so the sheet says it once', acr.noFinish === true);

const trv=find(patches, 'H1-138TRVDBA:1');
eq('traverse-only bracket', trv.traverseRole, 'TRV_BRACKET');
const bkt=find(patches, 'H1-138DD:1');
ok('BASIC is read', bkt.isBasic === true);
const std=find(patches, 'H1-138STDOFF:1');
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
eq('a repeat in the SAME slot is caught', d.patches.size, 1);
ok('and said out loud', d.warnings.some(w=>/twice in the same slot/.test(w)));
eq('the first wins', find(d.patches, 'X:1').itemNo, 'A');

const notASheet=parseTagRows([['A','B'],['1','2']]);
ok('a file that is not a tagging sheet is refused', /not a tagging sheet/.test(notASheet.warnings[0]));

// A blank cell leaves what is on screen; it never wipes it.
const loaded2=[{ clusterId:'c1', clusterName:'X', choices:[{ nodeName:'H1-138AR DBL BACK', itemNo:'H1-138AR', mountType:'CEILING' }]}];
const after2=applyTagPlan(loaded2, planTagImport(rows, loaded2));
eq('a blank cell does not clear an existing value', after2[0].choices[0].mountType, 'CEILING');

// ── the sheet defines the slots ──────────────────────────────────────────────────────────────
{
    const { slots, warnings: w } = slotsFromSheet(rows);
    eq('one slot per slot name', slots.length, 5);
    const pole = slots.find(s => s.label === 'METAL POLE DBL BACK LEFT');
    eq('category carried', pole.category, 'POLE');
    eq('its file carried', pole.file, 'a.fbx');
    const bkt = slots.find(s => s.label === 'Dec DBL Bracket Center');
    eq('bracket position carried', bkt.position, 'CENTER');
    const carrier = slots.find(s => s.label === 'POLE FR-MTR DBL Back');
    eq('a CARRIER slot becomes a RING slot', carrier.category, 'RING');
    ok('slots without a file are called out', !w.some(x => /name no .fbx/.test(x)));

    // …and matched to the files actually chosen, by name only.
    const files = [{ name: 'a.fbx' }, { name: 'B.FBX' }, { name: 'stray.fbx' }];
    const m = matchSlotFiles(slots, files);
    eq('matched pairs', m.paired.length, 2);
    ok('case does not matter', m.paired.some(p => p.file.name === 'B.FBX'));
    eq('slots with no file are listed', m.missing.length, 3);
    eq('files nothing asked for are listed', m.extra, ['stray.fbx']);
}

// The designer names several slots the same thing — one per file. They are different slots.
{
    const H=['SLOT','SLOT FILE (.fbx)','CAT','NODE NAME','ITEM ID'];
    const r=(slot,file,node)=>[slot,file,'POLE',node,''];
    const { slots } = slotsFromSheet([H,
        r('steel rod','left.fbx','L:1'), r('steel rod','right.fbx','R:1'), r('steel rod','center.fbx','C:1')]);
    eq('same name, three files, three slots', slots.length, 3);
    eq('each keeps its own file', slots.map(s=>s.file).sort().join(), 'center.fbx,left.fbx,right.fbx');
    ok('and their ids differ', new Set(slots.map(s=>s.id)).size === 3);
}

// ── A BLANK CELL NEVER TOUCHES ANYTHING ─────────────────────────────────────────────────────
// "her naming is a bit sloppy and all in the current assembly in the app are currently accurate and
//  correct and only missing these new double tags, so other than these new double tags, don't touch
//  em with the upload."
{
    const H2=['SLOT','SLOT FILE (.fbx)','CAT','NODE NAME','ITEM ID','ROD','PROJ','SETUP','TRV','MOUNT','MADE IN','BASIC','INL-BKT','FEE','HIDE','ALWAYS','COLLAR','NOTES'];
    // A singles row: everything blank except the two tags the double needs.
    const singleRow=['','','','H1-138BE:1','','', '', 'SINGLE','','','','','','','','','',''];
    const before=[{ clusterId:'c1', clusterName:'BRACKETS', choices:[{
        nodeName:'H1-138BE:1', itemNo:'H1-138BE', catOverride:'BRACKET', projInches:'4.625',
        mountType:'WALL', materials:'METAL', isBasic:true, inlineOnly:true, isFee:false,
        isHidden:false, alwaysShown:true, isCollar:false, requiresCollar:'H1-138FC2',
        endTreatment:'FINIAL', note:'hand-written note', trvSetup:'', tier:'',
    }]}];
    const plan=planTagImport([H2, singleRow], before);
    eq('exactly one field changes', plan.hits[0].diff.length, 1);
    eq('…and it is the setup', plan.hits[0].diff[0].field, 'trvSetup');

    const after=applyTagPlan(before, plan)[0].choices[0];
    eq('the new tag landed', after.trvSetup, 'SINGLE');
    // …and every single thing that was already right is still right.
    const untouched = ['itemNo','catOverride','projInches','mountType','materials','requiresCollar','endTreatment','note'];
    untouched.forEach(f => eq(`blank never rewrites ${f}`, after[f], before[0].choices[0][f]));
    ok('a ticked BASIC survives a blank cell', after.isBasic === true);
    ok('a ticked INL-BKT survives', after.inlineOnly === true);
    ok('a ticked ALWAYS survives', after.alwaysShown === true);
    ok('an unticked flag stays unticked', after.isFee === false && after.isHidden === false);

    // An explicit N is an answer, and does clear it.
    const off=[...singleRow]; off[11]='N';
    const cleared=applyTagPlan(before, planTagImport([H2, off], before))[0].choices[0];
    ok('an explicit N does untick', cleared.isBasic === false);
}

// ── THE SHEET IS WRITTEN AGAINST THE .FBX; THE PINS HOLD MERGED NAMES ───────────────────────
// Merge renames every node to <slot-prefix>__<n>_<original, punctuation stripped, 24 chars>.
{
    const H3=['SLOT','SLOT FILE (.fbx)','CAT','NODE NAME','ITEM ID','ROD','SETUP'];
    eq('a merged name yields its original tail', nodeTail('S12ABCDE-TRAV-DBL-BACKPLATES__3_H1138TRVBPV1'), 'H1138TRVBPV1');
    eq('a raw name is its own tail', nodeTail('H1-138TRVBP-V:1'), 'H1138TRVBPV1');

    const rows3=[H3,
      ['TRAV DBL Backplates Center','d.fbx','BACKPLATE','H1-138TRVBP-V:1','','','DOUBLE'],
      ['3','s.fbx','BACKPLATE','H1-138TRVBP-V:1','','','SINGLE']];
    // The SAME node name in both sections — the double's plate and the single's plate.
    const loaded=[
      { clusterId:'cD', clusterName:'TRAV-DBL-BACKPLATES-CENTER', choices:[{ nodeName:'S1AAAAA-TRAV-DBL-BACKPLATES-CENTER__2_H1138TRVBPV1', trvSetup:'' }]},
      { clusterId:'cS', clusterName:'3', choices:[{ nodeName:'S9BBBBB-3__7_H1138TRVBPV1', trvSetup:'' }]},
    ];
    const plan=planTagImport(rows3, loaded);
    eq('both merged pins are matched', plan.hits.length, 2);
    const dbl=plan.hits.find(h=>h.clusterId==='cD'), sing=plan.hits.find(h=>h.clusterId==='cS');
    eq('the double plate gets DOUBLE', dbl.patch.trvSetup, 'DOUBLE');
    eq('the single plate gets SINGLE — not the double row', sing.patch.trvSetup, 'SINGLE');

    // …and with no slot to separate them, it refuses rather than guessing.
    const blind=[{ clusterId:'cX', clusterName:'SOMETHING ELSE', choices:[{ nodeName:'S3CCCCC-X__1_H1138TRVBPV1' }]}];
    const p2=planTagImport(rows3, blind);
    eq('an unscoped collision is not guessed at', p2.hits.length, 0);
    ok('it is reported', p2.ambiguous.some(a=>/2 rows claim it/.test(a)));

    // A tail only one row claims still matches without a slot.
    const one=[H3,['ANY','a.fbx','POLE','H1-138R DBL Back','','BACK','DOUBLE']];
    const p3=planTagImport(one, [{ clusterId:'c', clusterName:'WHATEVER', choices:[{ nodeName:'S0ZZZZZ-WHATEVER__4_H1138RDBLBack'.toUpperCase() }] }]);
    eq('an unambiguous tail matches through the rename', p3.hits.length, 1);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail?1:0);
