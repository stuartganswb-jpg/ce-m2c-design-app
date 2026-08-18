// Every phrase here is one she actually wrote, taken from H1-1 assembly notes.xlsx.
import { tagsFromPhrase, clonesFromPhrase } from '../src/components/Shared/tagPhrase.js';
let pass=0, fail=0;
const has=(name, phrase, expect)=>{
    const got=tagsFromPhrase(phrase);
    const bad=Object.entries(expect).filter(([k,v])=>JSON.stringify(got[k])!==JSON.stringify(v));
    if(!bad.length) pass++; else { fail++; console.error('  ✗',name,'—',JSON.stringify(phrase),'\n    got ',JSON.stringify(got),'\n    want',JSON.stringify(expect)); }
};
const eq=(n,a,b)=>{ if(JSON.stringify(a)===JSON.stringify(b)) pass++; else { fail++; console.error('  ✗',n,'got',JSON.stringify(a),'want',JSON.stringify(b)); } };

has('a front pole piece',      'Pole Left Front',                 { cat:'POLE', position:'LEFT', tier:'FRONT' });
has('her "Ront" typo',         'Pole Right Ront',                 { cat:'POLE', position:'RIGHT' });
has('the short centre piece',  'Pole Short Front',                { cat:'POLE', position:'CENTER', tier:'FRONT' });
has('the rear rod',            'POLE DBL long Back',              { cat:'POLE', tier:'BACK', setup:'DOUBLE' });
has('a french return bills as a fee', 'FR 4 LEFT',                 { cat:'RETURN', position:'LEFT', proj:'4.625', fee:true, feeType:'FRENCH_RETURN' });
has('a miter return too',      'MTR 6 LEFT',                      { cat:'RETURN', position:'LEFT', proj:'6', fee:true, feeType:'MITER_RETURN' });
has('a combined FR-MTR row names neither', 'FR-MTR DBL RIGHT',  { fee:true, feeType:undefined });
has('a return BACKPLATE is not a fee', 'FR-MTR Back-Cover Plates 6 Left', { cat:'BACKPLATE', fee:undefined });
has('an in-line bracket',      'inL Bracket Arm 4 left',          { cat:'BRACKET', position:'LEFT', proj:'4.625', inline:true });
has('a basic bracket',         'BASIC BRACKET 3 CENTER',          { cat:'BRACKET', position:'CENTER', basic:true });
has('a decorative bracket',    'Dec Bracket Arm 6 right',         { cat:'BRACKET', position:'RIGHT', proj:'6' });
has('a passing bracket',       'Dec Passing Bracket Arm 4 Center',{ cat:'BRACKET', position:'CENTER', proj:'4.625' });
has('the double bracket',      'Dec DBL Bracket Arm Center',      { cat:'BRACKET', position:'CENTER', setup:'DOUBLE' });
has('a backplate',             'Dec-Back-Cover Plates 4 center',  { cat:'BACKPLATE', position:'CENTER', proj:'4.625' });
has('a return backplate',      'FR-MTR Back-Cover Plates DBL Left',{ cat:'BACKPLATE', position:'LEFT', setup:'DOUBLE' });
has('a ceiling bracket',       'Ceiling Bracket Arm Center',      { cat:'BRACKET', position:'CENTER', mount:'CEILING' });
has('an inside mount',         'Inside Mount Left',               { cat:'INSIDE_MOUNT', position:'LEFT' });
has('a finial',                'Finial Front Left',               { cat:'FINIAL', position:'LEFT', tier:'FRONT' });
has('a rear finial',           'Finial DBL Back Left',            { cat:'FINIAL', position:'LEFT', tier:'BACK', setup:'DOUBLE' });
has('hardware',                'Hide',                            { hide:true });
has('a traverse pole',         'TRV POLE DBL Back Long Right',    { cat:'POLE', position:'RIGHT', tier:'BACK', traverse:true });

// ⚠ "Back-Cover Plates" is a BACKPLATE, not the back ROD — the word BACK appears in both.
has('a backplate is not a rear rod', 'Dec DBL Back-Cover Plates Center', { cat:'BACKPLATE', tier:undefined });
// …and nothing is invented from a phrase that says nothing.
eq('an empty phrase says nothing', tagsFromPhrase(''), {});

// ── the clone column ─────────────────────────────────────────────────────────────────────────
eq('duplicate left and right',    clonesFromPhrase('DUPLICATE LEFT AND RIGHT'),  ['LEFT','RIGHT']);
eq('duplicate center and right',  clonesFromPhrase('DUPLICATE CENTER AND RIGHT'),['RIGHT','CENTER']);
eq('lowercase works',             clonesFromPhrase('Duplicate right'),           ['RIGHT']);
eq('centre spelled the other way',clonesFromPhrase('duplicate centre'),          ['CENTER']);
eq('a note that is not an instruction', clonesFromPhrase('check with Eric'),     []);
eq('nothing at all',              clonesFromPhrase(''),                          []);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail?1:0);
