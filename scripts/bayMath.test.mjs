// A miter return uses pole material too (Stuart 2026-09-18).   node scripts/bayMath.test.mjs
import { computeBayMath, miterReturnMaterial } from '../src/components/Shared/bayMath.js';
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n} — got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
eq('3-5/8" projection → 9-1/4"', miterReturnMaterial(3.625), 9.25);
eq('4-5/8" projection → 11-1/4" (Stuart\'s worked example)', miterReturnMaterial(4.625), 11.25);
eq('6" projection → 14"', miterReturnMaterial('6'), 14);
eq('no projection → nothing invented', miterReturnMaterial(''), 0);
const base = { shape: 'STRAIGHT', inputMode: 'POLE', w2: 18, poleDiameter: 1, insideMountDeduct: 0.25, gripAllowance: 8.5, bracketW: 1, mountLeft: 'OUTSIDE', mountRight: 'OUTSIDE' };
const run = (endStyle, endStyleRight, proj = 3.625) => computeBayMath({ engData: { ...base, endStyle, endStyleRight, proj }, safeProj: proj, libraryParts: [] });
const plain = run('FINIAL', 'FINIAL');
const miter = run('RETURN_MITER', 'RETURN_MITER');
const bend = run('RETURN_BEND', 'RETURN_BEND');
eq('two miters add 2 × 9.25" of stock to the raw cut', Math.round((miter.rawCenter - plain.rawCenter) * 100) / 100, 18.5);
eq('SO60551 row 2: an 18" fascia with two 3-5/8" miters cuts from 36.5"', Math.round(miter.totalPoleRawInches * 100) / 100, 36.5);
eq('one miter, one plain end adds one allowance', Math.round((run('RETURN_MITER', 'FINIAL').rawCenter - plain.rawCenter) * 100) / 100, 9.25);
eq('the French return is exactly as it was — the grip allowance per bent end', Math.round((bend.rawCenter - run('FINIAL', 'FINIAL').rawCenter + 1) * 100) / 100, 17);
eq('a deeper projection uses more', Math.round((run('RETURN_MITER', 'RETURN_MITER', 4.625).rawCenter - plain.rawCenter) * 100) / 100, 22.5);
console.log(`bayMath: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
