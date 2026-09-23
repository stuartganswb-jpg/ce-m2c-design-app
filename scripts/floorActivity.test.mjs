// The finishing floor's three windows + the document facts both floor screens read, offline.
//   node scripts/floorActivity.test.mjs
//
// 2026-09-23 (Stuart): "On the Floor really needs 3 job windows — Large Booth, Spin Machine and Hand
// Finish". A hand coat goes to Hand Finish because the RECIPE says so; a sprayed pole coat always to
// the booth; a sprayed small-parts coat where Start Setup sent it (Spin when nobody chose). If a row
// here breaks, the change is wrong — unless Stuart changed the rule.

import {
    woHasPoles, woHasSmallParts, partsStreamOf, poleStreamOf, isHandStep,
    sprayStationOf, windowOfCoat, windowOfTask, coatTaskKeys, comingCoatsOf, asksSprayStation,
} from '../src/components/Shared/floorActivity.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};

// A P24-shaped recipe: sprayed, hand, sprayed.
const SPRAY = (color) => ({ color, app: 'Sprayed' });
const HAND = (color) => ({ color, app: 'Hand Applied' });
const P24 = [SPRAY('Base'), HAND('Brush'), SPRAY('Clear')];
const cap = { id: 'WO-OE-H1-75SPF-1', recipe: 'P24', totalParts: 50, productType: 'FINIAL' };

// ── the document facts (moved verbatim from ActiveFloor) ──
eq('a small part has no poles', woHasPoles(cap), false);
eq('…and is all small parts', woHasSmallParts(cap), true);
eq('a pole-only order has no small parts', woHasSmallParts({ totalPoles: 20, totalParts: 20 }), false);
eq('a counted pole order with S/M/L sizes keeps both streams', woHasSmallParts({ totalPoles: 2, totalParts: 10, paintSizes: { S: 8 } }), true);
eq('an untagged rod runs the POLES stream on its parts side', partsStreamOf({ productType: 'ROD' }), 'POLES');
eq('finishStream SMALL on a pole item runs its pole stream small', poleStreamOf({ productType: 'POLE', finishStream: 'SMALL' }), 'SMALL');
eq('hand is matched on the word, however it is spelled', [isHandStep(HAND('x')), isHandStep({ app: 'hand' }), isHandStep({ app: 'HAND APPLIED ' }), isHandStep(SPRAY('x')), isHandStep(null)], [true, true, true, false, false]);

// ── which window ──
eq('no choice made reads Spin (every document before 2026-09-23)', sprayStationOf(cap), 'SPIN');
eq('Booth chosen reads Booth, however it is cased', sprayStationOf({ sprayStation: 'booth' }), 'BOOTH');
eq('a sprayed small-parts coat → where Start Setup sent it', [windowOfCoat('parts', SPRAY('a'), cap), windowOfCoat('parts', SPRAY('a'), { sprayStation: 'BOOTH' })], ['SPIN', 'BOOTH']);
eq('a sprayed pole coat → the booth, always', windowOfCoat('poles', SPRAY('a'), { sprayStation: 'SPIN' }), 'BOOTH');
eq('a hand coat → Hand Finish, poles or small parts', [windowOfCoat('parts', HAND('a'), { sprayStation: 'BOOTH' }), windowOfCoat('poles', HAND('a'), {})], ['HAND', 'HAND']);
eq('past the end of the recipe there is no window', windowOfCoat('parts', undefined, cap), null);
eq('a task belongs where its kind is worked', ['hand', 'poleHand', 'poleSpray', 'poleBake', 'spinBake'].map(k => windowOfTask(k, { sprayStation: 'BOOTH' })), ['HAND', 'HAND', 'BOOTH', 'BOOTH', 'BOOTH']);
eq('a coat is made of the same tasks the Manual Floor Control buttons press',
    [coatTaskKeys('parts', SPRAY('a')), coatTaskKeys('parts', HAND('a')), coatTaskKeys('poles', SPRAY('a')), coatTaskKeys('poles', HAND('a')), coatTaskKeys('parts', null)],
    [['spinSetup', 'spinSpray', 'spinBake'], ['hand'], ['poleSpray', 'poleBake'], ['poleHand'], []]);

// ── coming: the case that started this — P24's hand coat was on no screen at coat 1 ──
eq('at coat 1 the hand coat is COMING to Hand Finish', comingCoatsOf(P24, 0, 'parts', cap).map(c => [c.window, c.coat, c.of]), [['HAND', 2, 3]]);
eq('at the hand coat, the clear coat is coming back to the spin machine', comingCoatsOf(P24, 1, 'parts', cap).map(c => [c.window, c.coat]), [['SPIN', 3]]);
eq('on the last coat nothing is coming', comingCoatsOf(P24, 2, 'parts', cap), []);
eq('a later coat in the window the job is already in adds nothing', comingCoatsOf([SPRAY('a'), SPRAY('b'), HAND('c'), HAND('d')], 0, 'parts', cap).map(c => c.coat), [3]);
eq('a booth job\'s coming coats name the booth', comingCoatsOf([HAND('a'), SPRAY('b')], 0, 'parts', { sprayStation: 'BOOTH' }).map(c => c.window), ['BOOTH']);
eq('no recipe, nothing coming (and no crash)', comingCoatsOf(undefined, 0, 'parts', cap), []);

// ── Start Setup asks Spin or Booth only when the small parts have something to spray ──
const recipes = { P24: { steps: P24 }, HB: { steps: [HAND('a'), HAND('b')] }, 'CP': { steps: [SPRAY('x')] }, 'CP-P': { steps: [HAND('p')] } };
eq('a small part with sprayed coats is asked', asksSprayStation(cap, recipes), true);
eq('a pole-only order is never asked — poles go to the booth', asksSprayStation({ recipe: 'P24', totalPoles: 8, totalParts: 8 }, recipes), false);
eq('hand-applied on every coat is never asked', asksSprayStation({ recipe: 'HB', totalParts: 10 }, recipes), false);
eq('the small-parts stream reads its own -P variant (the elbow): all hand there, not asked', asksSprayStation({ recipe: 'CP', totalParts: 4, finishStream: 'POLES' }, recipes), false);
eq('an unresolvable recipe still asks — a choice is harmless, a missing one is not', asksSprayStation({ recipe: 'NOPE', totalParts: 4 }, recipes), true);
eq('no document, no question', asksSprayStation(null, recipes), false);

console.log(`floorActivity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
