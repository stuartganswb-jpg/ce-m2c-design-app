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

// A RETURN ARM IS ITS OWN PIECE (Stuart 2026-10-21, M2C Flat Iron on Vision: 57" with return arms read TUBE B CUT 78.00"):
// "the rod cut should be the rod cut length not any longer as it is its own piece … when miter cut we add the length when
// using return arms we do not". The arms still land on their plates, so what has to fit the opening is unchanged.
const plate2 = { id: 'BP-2', manufacturingSpecs: { parametric: { width: 2 }, customData: { bpOrientation: 'VERTICAL' } } };
const flat = (endStyle, endStyleRight) => computeBayMath({ engData: { ...base, w2: 57, endStyle, endStyleRight, proj: 4.25, backplateIdLeft: 'BP-2', backplateIdRight: 'BP-2' }, safeProj: 4.25, libraryParts: [plate2] });
const arms = flat('RETURN_ARM', 'RETURN_ARM');
eq('Stuart\'s Flat Iron: 57" with two return arms cuts 57" — it read 78 (57 + 2 × 10.5)', [arms.rawCenter, arms.totalPoleRawInches, arms.poleFeetQty], [57, 57, 5]);
eq('…no miter returns are counted for arms (nothing to weld, no wide box)', arms.qtyMiterReturns, 0);
eq('…and the fit is what it was: each arm lands on its 2" plate — 57 + 1 + 1 = 59, 20 rings', [arms.endAddL, arms.endAddR, arms.totalSystemO2O, arms.recRings], [1, 1, 59, 20]);
eq('…the same fit as when the arms read as miters (only the cut and the miter count move)', [flat('RETURN_MITER', 'RETURN_MITER').totalSystemO2O, flat('RETURN_MITER', 'RETURN_MITER').rawCenter, flat('RETURN_MITER', 'RETURN_MITER').qtyMiterReturns], [59, 78, 2]);
const mixed = flat('RETURN_MITER', 'RETURN_ARM');
eq('a miter on one end and an arm on the other: one allowance, one miter', [mixed.rawCenter, mixed.qtyMiterReturns], [67.5, 1]);
console.log(`bayMath: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
