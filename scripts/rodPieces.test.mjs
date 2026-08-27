// The rod-piece waste rule, offline.
//   node scripts/rodPieces.test.mjs
//
// Stuart's two calibration examples (2026-08-27) are the acceptance tests: from a 96" piece, a
// 72" order must NOT take the piece (24" dead zone → new rod), and an 80" order MUST take it
// (16" scrap). If a rule change breaks either of these, the change is wrong, not the test.

import {
    MIN_USABLE_IN, MAX_WASTE_IN, rodCodeKey, isRodClassified, configEntryFor, pieceLengthInFor,
    evaluateCut, scrapFeet, rankCandidates, planCuts, sweepScrap, honestAvailability,
    scrapAdjustmentPayload,
} from '../src/components/Shared/rodPieces.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── STUART'S EXAMPLES — THE ACCEPTANCE TESTS ─────────────────────────────────────────────────
{
    eq("96\" piece + 72\" order → dead zone (24\" is unusable and over the waste cap)",
        evaluateCut(96, 72), { action: 'DEAD', remainderIn: 24, scrapIn: 24 });
    eq("96\" piece + 80\" order → use it, scrap the 16\"",
        evaluateCut(96, 80), { action: 'SCRAP', remainderIn: 0, scrapIn: 16 });
    eq("…and that 16\" of scrap posts as 2 ft (round UP)", scrapFeet(16), 2);

    // The dead-zone rejection must actually route to a new rod when one is on the shelf.
    const pieces = [{ id: 'p96', lengthIn: 96 }];
    const { options, rejected } = rankCandidates({ cutIn: 72, pieces, pieceLengthIn: 144 });
    eq('72" order vs a 96" piece + 12 ft stock → cut a NEW rod', options[0]?.source, 'NEW');
    eq('…which keeps a 72" remainder in the ledger', [options[0].action, options[0].remainderIn], ['KEEP', 72]);
    eq('…and the 96" piece is listed as rejected, not offered', rejected.map(r => r.piece.id), ['p96']);
}

// ── THE BOUNDARIES ───────────────────────────────────────────────────────────────────────────
{
    eq('remainder exactly 36" → keep', evaluateCut(108, 72).action, 'KEEP');
    eq('remainder exactly 18" → scrap-and-use', evaluateCut(90, 72).action, 'SCRAP');
    eq('remainder 18.5" → dead zone', evaluateCut(90.5, 72).action, 'DEAD');
    eq('remainder 35.9" → dead zone', evaluateCut(107.9, 72).action, 'DEAD');
    eq('exact fit → use it, zero scrap', evaluateCut(72, 72), { action: 'SCRAP', remainderIn: 0, scrapIn: 0 });
    eq('cut longer than the piece → no fit', evaluateCut(60, 72).action, 'NO_FIT');
    ok('constants read as specced', MIN_USABLE_IN === 36 && MAX_WASTE_IN === 18);
}

// ── "ALWAYS USE THE CUTS WHEN POSSIBLE" — RANKING ────────────────────────────────────────────
{
    // A 7 ft (84") piece serves a 6 ft (72") order with 12" waste — better than a new rod.
    const { options } = rankCandidates({ cutIn: 72, pieces: [{ id: 'p84', lengthIn: 84 }], pieceLengthIn: 144 });
    eq("his sentence verbatim: 7 ft piece beats a new rod for a 6 ft order", options[0]?.piece?.id, 'p84');
    eq('…consumed whole, 12" scrap', [options[0].action, options[0].scrapIn], ['SCRAP', 12]);

    // Full-consume beats opening a big piece; least scrap breaks the tie between consumes.
    const pool = [{ id: 'p120', lengthIn: 120 }, { id: 'p78', lengthIn: 78 }, { id: 'p74', lengthIn: 74 }];
    const r = rankCandidates({ cutIn: 72, pieces: pool, pieceLengthIn: 144 });
    eq('a ≤18" full-consume beats opening a 120" piece', r.options[0]?.piece?.id, 'p74');
    eq('…least scrap first among consumes', r.options.map(o => o.piece?.id || 'NEW'), ['p74', 'p78', 'p120', 'NEW']);

    // Equal candidates burn down FIFO.
    const fifo = rankCandidates({ cutIn: 72, pieces: [{ id: 'b', lengthIn: 78, createdAt: 2 }, { id: 'a', lengthIn: 78, createdAt: 1 }] });
    eq('equal pieces: oldest first', fifo.options.map(o => o.piece.id), ['a', 'b']);

    // Only OFFCUT pieces are candidates.
    const st = rankCandidates({ cutIn: 40, pieces: [{ id: 's', lengthIn: 80, status: 'SCRAP' }, { id: 'c', lengthIn: 80, status: 'CONSUMED' }, { id: 'o', lengthIn: 80, status: 'OFFCUT' }] });
    eq('scrapped/consumed pieces never offered', st.options.map(o => o.piece.id), ['o']);
}

// ── THE PLANNER — MULTI-CUT ORDERS ───────────────────────────────────────────────────────────
{
    // Straight (splice) cuts match independently — and sequentially: one 96" piece serves both
    // 40" cuts (96 → 56 → 16" scrap) instead of the second cut opening a new rod.
    const plan = planCuts({
        cuts: [{ id: 'L', label: 'Left', lengthIn: 40 }, { id: 'R', label: 'Right', lengthIn: 40 }],
        pieces: [{ id: 'p96', lengthIn: 96 }], pieceLengthIn: 144,
    });
    eq('two straight 40" cuts: both from the one 96" piece',
        plan.assignments.map(a => a.choice.source), ['PIECE', 'PIECE']);
    eq('…second cut takes the first cut\'s remainder', plan.assignments[1].choice.piece.fromPieceId, 'p96');
    eq('…16" scrap total, no new rods', [plan.totalScrapIn, plan.newRods], [16, 0]);

    // Longest first: the 80" cut consumes the 96" piece whole (16" scrap — his example), and the
    // 40" cut opens the new rod. A naive in-order pass would give the 40" cut the piece and
    // strand the 80" cut on a new rod with the 96" piece rejected as dead-zone.
    const p2 = planCuts({
        cuts: [{ id: 'a', lengthIn: 40 }, { id: 'b', lengthIn: 80 }],
        pieces: [{ id: 'p96', lengthIn: 96 }], pieceLengthIn: 144,
    });
    eq('longest cut planned first, results in caller order',
        p2.assignments.map(a => [a.cut.id, a.choice.source]), [['a', 'NEW'], ['b', 'PIECE']]);
    eq('…the 80" cut got the real piece', p2.assignments[1].choice.piece.id, 'p96');
    eq('…16" scrap, one new rod', [p2.totalScrapIn, p2.newRods], [16, 1]);

    // MITER: all pieces from ONE rod — combined length against one source.
    const m = planCuts({
        cuts: [{ id: 'L', lengthIn: 40 }, { id: 'C', lengthIn: 40 }, { id: 'R', lengthIn: 40 }],
        pieces: [{ id: 'p96', lengthIn: 96 }], pieceLengthIn: 144, miter: true,
    });
    eq('miter: one combined 120" cut', [m.miterCombined, m.assignments.length], [true, 1]);
    eq('…the 96" piece cannot serve it → new rod', m.assignments[0].choice.source, 'NEW');
    eq('…and the 144−120 = 24" new-rod remainder is swept to scrap (under 36", no alternative)',
        [m.assignments[0].choice.action, m.totalScrapIn], ['SCRAP', 24]);

    // No source at all (no config, no fitting piece) → an honest null, not a guess.
    const none = planCuts({ cuts: [{ id: 'x', lengthIn: 300 }], pieces: [{ id: 'p96', lengthIn: 96 }], pieceLengthIn: 144 });
    eq('a cut nothing can serve → choice null', none.assignments[0].choice, null);
}

// ── SWEEP, AVAILABILITY, ROUNDING ────────────────────────────────────────────────────────────
{
    eq('standing sweep: offcuts under 36" are scrap',
        sweepScrap([{ id: 'a', lengthIn: 20 }, { id: 'b', lengthIn: 36 }, { id: 'c', lengthIn: 35.5 }, { id: 'd', lengthIn: 12, status: 'SCRAP' }]).map(p => p.id),
        ['a', 'c']);
    eq('scrap rounding: 12" → 1 ft, 13" → 2 ft, 24" → 2 ft, 0 → 0',
        [scrapFeet(12), scrapFeet(13), scrapFeet(24), scrapFeet(0)], [1, 2, 2, 0]);
    // 200 ft of NS feet holding 2 offcuts (84" + 36") at 20 ft stock = 9 full rods left.
    eq('honest availability: NS 200 ft − 120" of offcuts @ 20 ft = 9 full',
        honestAvailability({ nsFeet: 200, pieces: [{ lengthIn: 84 }, { lengthIn: 36 }], pieceLengthIn: 240 }),
        { offcutCount: 2, offcutIn: 120, longestIn: 84, fullPieces: 9 });
    eq('…no NS feet → fullPieces null (shop vantage shows pieces only)',
        honestAvailability({ pieces: [{ lengthIn: 84 }] }).fullPieces, null);
}

// ── IDENTITY & CONFIG MATCHING ───────────────────────────────────────────────────────────────
{
    eq('finish suffix ignored: H1-138R/P keys with H1-138R', rodCodeKey('H1-138R/P'), rodCodeKey('h1 138r'));
    eq('species stays distinct: -O is not the same stock as -W', rodCodeKey('H1-138WR-O') === rodCodeKey('H1-138WR-W'), false);
    const cfg = { items: { [rodCodeKey('H1-138R')]: { code: 'H1-138R', pieceLengthFt: 12 } } };
    eq('config matches through the finish suffix', configEntryFor('H1-138R/EP3', cfg)?.pieceLengthFt, 12);
    eq('piece length in inches', pieceLengthInFor('h1-138r', cfg), 144);
    eq('unconfigured item → null (no plan, no guess)', pieceLengthInFor('HTA1235', cfg), null);
    ok('classification: productType POLE counts', isRodClassified({ manufacturingSpecs: { productType: 'Pole' } }));
    ok('classification: FASCIA tag counts', isRodClassified({ tags: ['TRAVERSE FASCIA'] }));
    ok('classification: a finial does not', !isRodClassified({ manufacturingSpecs: { productType: 'FINIAL' } }));
    ok('classification: RODEO does not sneak in on substring', !isRodClassified({ manufacturingSpecs: { productType: 'RODEO' } }));
}

// ── THE NS PAYLOAD ───────────────────────────────────────────────────────────────────────────
{
    const p = scrapAdjustmentPayload({ internalId: 4242, nsConfig: { subsidiary: '2', location: '17' }, feet: 2, memo: 'm', bin: 'A-1' });
    eq('one negative line, acct 254', [p.payload.account.id, p.payload.inventory.items[0].adjustQtyBy], ['254', -2]);
    eq('bin detail rides only when a bin is given',
        [!!p.payload.inventory.items[0].inventoryDetail,
         !!scrapAdjustmentPayload({ internalId: 1, nsConfig: { subsidiary: '2', location: '17' }, feet: 1 }).payload.inventory.items[0].inventoryDetail],
        [true, false]);
    eq('no internal id / no feet → null (caller keeps it PENDING, never posts junk)',
        [scrapAdjustmentPayload({ nsConfig: {}, feet: 2 }), scrapAdjustmentPayload({ internalId: 1, nsConfig: {}, feet: 0 })], [null, null]);
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
