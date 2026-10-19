// 🧪 A sprayed coat on wood air-dries; it is never baked (Grace, App Imp 2026-10-19 · Stuart: "yes, 20min air dry").
//    node scripts/airDry.test.mjs
import { woAirDries, isAirDryStep, isOvenStep, airDryMinsOf, dryMinsOf, dryAwareLabel, dryAwareLabelEs, WOOD_AIR_DRY_MINS } from '../src/components/Shared/airDry.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// the finish library as it read 2026-10-19 (a slice): the stains WOOD, the M2C stains WOOD, the old CW/W metal-tagged
const FIN = [
    { code: 'S04', material: 'WOOD' }, { code: 'S03', material: 'WOOD' }, { code: 'SM04', material: 'WOOD' }, { code: 'WNC', material: 'WOOD' },
    { code: 'P16', material: 'METAL' }, { code: 'EP3', material: 'METAL' }, { code: 'CW31', material: 'METAL' }, { code: 'W15', material: 'METAL' },
];
const wo = (recipe, extra = {}) => ({ recipe, ...extra });

eq('a stain (S04) air-dries', woAirDries(wo('S04'), FIN), true);
eq('"CODE - Name" as RTG stamps it', woAirDries(wo('S03 - Pure Oak'), FIN), true);
eq('an M2C stain is wood because the LIBRARY says so', [woAirDries(wo('SM04'), FIN), woAirDries(wo('SM04'), null)], [true, false]);
eq('a stream variant shares its finish (SM04-S, S03-P)', [woAirDries(wo('SM04-S'), FIN), woAirDries(wo('S03-P'), FIN)], [true, true]);
eq('a paint, a plating, the old metal-tagged CW/W bake as before', ['P16', 'EP3', 'CW31', 'W15'].map(r => woAirDries(wo(r), FIN)), [false, false, false, false]);
eq('no list: the S-code fallback still knows a CE stain', woAirDries(wo('S08'), null), true);
eq('nothing to read → bakes', [woAirDries(null, FIN), woAirDries(wo(''), FIN)], [false, false]);

eq('the dry slot on wood is an air dry, not the oven', [isAirDryStep('spinBake', wo('S04'), FIN), isAirDryStep('poleBake', wo('S04'), FIN), isOvenStep('spinBake', wo('S04'), FIN)], [true, true, false]);
eq('on paint it is the oven', [isAirDryStep('spinBake', wo('P16'), FIN), isOvenStep('spinBake', wo('P16'), FIN), isOvenStep('poleBake', wo('P16'), FIN)], [false, true, true]);
eq('only the dry slot — a spray or a hand coat is neither', [isAirDryStep('spinSpray', wo('S04'), FIN), isOvenStep('hand', wo('P16'), FIN)], [false, false]);

const cfg = { ovenMins: 30 };
eq('the air dry is 20 minutes', [WOOD_AIR_DRY_MINS, airDryMinsOf(cfg), dryMinsOf('spinBake', wo('S04'), cfg, FIN), dryMinsOf('poleBake', wo('SM04'), cfg, FIN)], [20, 20, 20, 20]);
eq('the oven keeps its own (bakeMins accepted)', [dryMinsOf('spinBake', wo('P16'), cfg, FIN), dryMinsOf('poleBake', wo('P16'), { bakeMins: 12 }, FIN)], [30, 12]);
eq('a floor setting may carry its own air-dry time', airDryMinsOf({ woodAirDryMins: 25 }), 25);
eq('not a dry slot → 0', dryMinsOf('spinSpray', wo('S04'), cfg, FIN), 0);

eq('the words: Air Dry / Pole Air Dry on wood, the caller\'s own otherwise', [dryAwareLabel('spinBake', wo('S04'), FIN, 'Sled Bake'), dryAwareLabel('poleBake', wo('S04'), FIN, 'Pole Bake'), dryAwareLabel('spinBake', wo('P16'), FIN, 'Sled Bake')], ['Air Dry', 'Pole Air Dry', 'Sled Bake']);
eq('…and in Spanish', [dryAwareLabelEs('spinBake', wo('S04'), FIN, 'Horno'), dryAwareLabelEs('poleBake', wo('P16'), FIN, 'Horno de barras')], ['Secado al aire', 'Horno de barras']);

console.log(`airDry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
