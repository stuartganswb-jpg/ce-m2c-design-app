// ── THE FINISHING SCHEDULE, COUNTED AS THE FLOOR RUNS IT (Stuart 2026-10-13) ───────────────────────────────────
// The plan under the Setup Queue was written in June for one recipe per order on a sled, and the floor moved on
// without it. Read live on 2026-10-13 it was out by more than a day:
//   · 180 SG and CP stock poles were priced on the MASTER recipe — no hand coat — where the poles run SG-P / CP-P,
//     four coats with one by hand: about thirty hours of hand finishing the schedule did not show;
//   · three customer orders' poles were listed as ready "stock poles", one still being cut in the shop;
//   · every customer order read "awaiting fab & scan-match", including ones with no shop half at all;
//   · WO11686 was counted at 420 pieces with 376 of them already through every coat;
//   · a job sent to the booth was counted in sleds — it never takes one;
//   · a part line spelled `quantity` (a stock run, a paint run, an Order Entry pair) counted for nothing.
//
// The same plan, counted from what each document says today:
//   1. each TRACK on its own recipe — small parts and poles apart, -S / -P where they exist, and the copy an order
//      keeps once it has begun (Shared/floorActivity.partsRecipeOfWo / poleRecipeOfWo);
//   2. only what is LEFT — the coats from the one a track is on, and on a spin job in loads the pieces still to run;
//   3. hand time for every hand coat left, not once a recipe;
//   4. SPIN or BOOTH — a sled is for small parts on the spin machine; a booth job is counted in booth loads
//      (Stuart: "10-30 parts take 15 minutes each coat on the recipe plus same bake time as the sled");
//   5. READY is the floor's own word — a customer order by the sentence its Setup Queue card prints
//      (Shared/orderStatus.stageWaitsOnMatch), a stock order by the open-pick gate (pickGateOf); a customer order's
//      poles are scheduled WITH their order, never among the stock poles.
// The wall-clock estimate is still the one oven's bakes plus the hand work that does not fit inside the pole bakes;
// how many painters spray at once is not modelled. Pure — no React, no Firestore. Harness: scripts/finishingPlan.test.mjs.

import { packFootprint, sledsFromFootprint, streamRecipeKey, POLE_RACK } from './finishingTime.js';
import { woHasPoles, woHasSmallParts, partsRecipeOfWo, poleRecipeOfWo, partsStreamOf, poleStreamOf, poleCoatIndexOf,
    isHandStep, sprayStationOf, SPRAY_STATIONS, recipeCopyInForce } from './floorActivity.js';
import { isSalesDoc, stageWaitsOnMatch, pickGateOf } from './orderStatus.js';
import { spinLoadsOf, smallPartsTotalOf, runsInLoads } from './spinLoads.js';
import { isPoleCategory } from './poleCut.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const PLANNABLE = ['Setup', 'setup', 'Painting'];
const onFloor = (wo) => !!wo && wo.currentPhase === 'Painting';

/** The booth, as Stuart timed it — both are settings in Production Times (fin_config/settings). */
export const BOOTH_COAT_MINS = 15;
export const BOOTH_LOAD_PCS = 30;

/** The timers the plan prices with — the same defaults the Active Floor uses where one was never saved. */
export function planTimersOf(t = {}) {
    return {
        spinSetup: num(t.spinSetupMins) || 10, spinPaint: num(t.spinPaintMins) || 3, oven: num(t.ovenMins) || 10,
        handSmall: num(t.handSmallMins) || 1.35, handPole: num(t.handPoleMins) || 10, pole: num(t.poleMins) || 5,
        boothCoat: num(t.boothCoatMins) || BOOTH_COAT_MINS, boothLoad: Math.max(1, Math.floor(num(t.boothLoadPcs)) || BOOTH_LOAD_PCS),
    };
}

const stepsOf = (recipe) => (recipe && Array.isArray(recipe.steps) ? recipe.steps : []);
const isSprayed = (s) => !!s && String(s.app || '') === 'Sprayed';
/** S = sprayed (its own bake), H = by hand, N = neither — what is left of a track, as one comparable word. */
const signatureOf = (steps) => steps.map(s => (isSprayed(s) ? 'S' : isHandStep(s) ? 'H' : 'N')).join('');

/**
 * Why a document cannot be scheduled onto the machines yet — '' when it can.
 * A customer order: the sentence its Setup Queue card prints. A stock order: the open-pick gate.
 */
export function scheduleWaitOf(wo) {
    if (!wo || onFloor(wo)) return '';
    const s = stageWaitsOnMatch(wo);
    if (s) return s;
    if (isSalesDoc(wo)) return '';
    if (!pickGateOf(wo).blocked) return '';
    return wo.sentToPickPack ? 'Waiting on the WMS pick — parts not picked yet' : 'Waiting on Start Setup — the parts pull is not released yet';
}

// The small parts FINISHED on this document, by size and type — for the sled count. A pick-only line (picked finished
// off the shelf), a fee and a kit holder are not finished here; a pole on the parts list rides the pole track.
const pcsOf = (p) => num(p && p.pcs) || num(p && p.quantity) || num(p && p.qty);
function smallLinesOf(wo) {
    const total = smallPartsTotalOf(wo);
    const list = (Array.isArray(wo.partsList) ? wo.partsList : []).filter(p => p && !p.isFee && !p.lineIsFee && !p.isKit && p.pickOnly !== true && pcsOf(p) > 0);
    const sized = list.filter(p => (p.paintSize || p.productType) && !isPoleCategory(p.productType));
    if (!sized.length) return total > 0 ? [{ size: wo.paintSize, type: isPoleCategory(wo.productType) ? '' : wo.productType, qty: total }] : [];
    const sum = sized.reduce((a, p) => a + pcsOf(p), 0);
    // The document's own count of small parts is the count; the lines give the size mix.
    const k = (total > 0 && sum > 0) ? total / sum : 1;
    return sized.map(p => ({ size: p.paintSize, type: p.productType, qty: pcsOf(p) * k }));
}

/**
 * What is left to run on one document, track by track.
 * @returns {{ parts: null | { key, kept, station, pieces, chunks: [{ pieces, steps }], lines, resolved },
 *             poles: null | { key, kept, poles, steps, resolved, done } }}
 * A spin job in loads: the load on the machine has the coats from the one it is on; the loads after it, all of them.
 */
export function tracksOf(wo, recipes) {
    const out = { parts: null, poles: null };
    if (!wo) return out;
    const base = String(wo.recipe || '').split(' - ')[0].trim();
    if (woHasSmallParts(wo)) {
        const recipe = partsRecipeOfWo(recipes, wo);
        const all = stepsOf(recipe);
        const idx = Math.min(num(wo.currentStepIndex), all.length);
        const left = all.slice(idx);
        const total = smallPartsTotalOf(wo);
        let chunks = [{ pieces: total, steps: left }];
        if (runsInLoads(wo)) {
            const s = spinLoadsOf(wo);
            const later = Math.max(0, s.remaining - s.qty);
            chunks = [{ pieces: s.qty, steps: left }, ...(later > 0 ? [{ pieces: later, steps: all }] : [])];
        }
        // A track past its last coat has nothing left; a recipe the floor cannot find is still SHOWN, unpriced.
        const done = all.length > 0 && idx >= all.length;
        chunks = done ? [] : chunks.filter(c => c.pieces > 0 && (c.steps.length || !all.length));
        out.parts = {
            key: streamRecipeKey(recipes, base, partsStreamOf(wo)) || base || '(no recipe)', kept: !!recipeCopyInForce(wo, 'parts'),
            station: sprayStationOf(wo), pieces: chunks.reduce((a, c) => a + c.pieces, 0), total, chunks, lines: smallLinesOf(wo), resolved: all.length > 0,
        };
    }
    if (woHasPoles(wo)) {
        const recipe = poleRecipeOfWo(recipes, wo);
        const all = stepsOf(recipe);
        const idx = Math.min(poleCoatIndexOf(wo), all.length);
        const poles = num(wo.totalPoles) || num(wo.poles && wo.poles.qty) || (woHasSmallParts(wo) ? 0 : num(wo.totalParts));
        out.poles = {
            key: streamRecipeKey(recipes, base, poleStreamOf(wo)) || base || '(no recipe)', kept: !!recipeCopyInForce(wo, 'poles'),
            poles, steps: all.slice(idx), resolved: all.length > 0, done: all.length > 0 && idx >= all.length,
        };
    }
    return out;
}

const sizeMixOf = (lines) => lines.reduce((m, l) => { const s = String(l.size || '').toUpperCase(); if (['S', 'M', 'L'].includes(s)) m[s] += num(l.qty); return m; }, { S: 0, M: 0, L: 0 });
const earliest = (wos) => wos.map(w => w.reqDate).filter(Boolean).sort()[0] || null;

// One small-parts row: `items` = [{ wo, track }] sharing a recipe key, a station and the same coats left per chunk.
function priceParts(items, kind, matrix, T) {
    const first = items[0].track;
    const booth = first.station === SPRAY_STATIONS.BOOTH;
    let pieces = 0, sleds = 0, loads = 0, machineMins = 0, ovenMins = 0, handMins = 0, resolved = true;
    // Chunks with the same coats left pool together (two orders of a recipe fill one sled between them).
    const bySig = new Map();
    items.forEach(({ track }) => {
        const fp = packFootprint(track.lines, matrix);
        if (!track.resolved || (!booth && !fp.resolved)) resolved = false;
        track.chunks.forEach(c => {
            const sig = signatureOf(c.steps);
            const g = bySig.get(sig) || { steps: c.steps, pieces: 0, footprint: 0 };
            g.pieces += c.pieces;
            g.footprint += track.total > 0 ? fp.footprint * (c.pieces / track.total) : 0;
            bySig.set(sig, g);
        });
    });
    let sprayedLeft = 0, handLeft = 0;
    bySig.forEach(g => {
        const sprayed = g.steps.filter(isSprayed).length, hand = g.steps.filter(isHandStep).length;
        sprayedLeft = Math.max(sprayedLeft, sprayed); handLeft = Math.max(handLeft, hand);
        pieces += g.pieces;
        handMins += g.pieces * T.handSmall * hand;
        if (booth) {
            const n = Math.ceil(g.pieces / T.boothLoad);
            loads += n;
            machineMins += n * sprayed * (T.boothCoat + T.oven);
            ovenMins += n * sprayed * T.oven;
        } else {
            const n = sledsFromFootprint(g.footprint, g.pieces);
            sleds += n;
            // Load the sled once, a spray and a bake for every sprayed coat, off the machine and back on for a hand coat.
            machineMins += n * (T.spinSetup + sprayed * (T.spinPaint + T.oven) + hand * 2 * T.spinSetup);
            ovenMins += n * sprayed * T.oven;
        }
    });
    const wos = items.map(i => i.wo);
    const lines = items.flatMap(i => i.track.lines);
    const mix = sizeMixOf(lines);
    return {
        kind, track: 'parts', recipe: first.key, kept: items.some(i => i.track.kept), station: first.station,
        wos, woCount: wos.length, parts: Math.round(pieces), sleds, loads,
        sizeMix: mix, distinctSizes: ['S', 'M', 'L'].filter(s => mix[s] > 0).length,
        sprayedSteps: sprayedLeft, handCoats: handLeft, hasHand: handLeft > 0, reqDate: earliest(wos),
        machineMins: machineMins + handMins, handMins, ovenMins, resolved,
        running: wos.some(onFloor),
    };
}

// One pole row: `items` = [{ wo, track }] sharing a pole recipe key and the same coats left. Racked eight at a time.
function pricePoles(items, kind, T) {
    const first = items[0].track;
    const poles = items.reduce((a, i) => a + i.track.poles, 0);
    const racks = poles > 0 ? Math.ceil(poles / POLE_RACK) : 0;
    const sprayed = first.steps.filter(isSprayed).length, hand = first.steps.filter(isHandStep).length;
    const wos = items.map(i => i.wo);
    return {
        kind, track: 'poles', recipe: first.key, kept: items.some(i => i.track.kept),
        wos, woCount: wos.length, poles, racks,
        sprayedSteps: sprayed, handCoats: hand, hasHand: hand > 0, reqDate: earliest(wos),
        sprayMins: poles * T.pole * sprayed, ovenMins: racks * sprayed * T.oven, handMins: poles * T.handPole * hand,
        resolved: items.every(i => i.track.resolved),
        running: wos.some(onFloor),
    };
}

/**
 * The sequenced plan. `workOrders` = the finishing documents to plan (the caller leaves out a held document and
 * another floor's). Customer orders one by one, by due date; stock pooled by recipe to fill the machine.
 */
export function buildFinishingPlan(workOrders = [], recipes = {}, matrix = {}, timers = {}, opts = {}) {
    const T = planTimersOf(timers);
    const docs = (workOrders || []).filter(w => w && PLANNABLE.includes(w.currentPhase) && w.pickOnly !== true)
        .map(wo => ({ wo, tracks: tracksOf(wo, recipes), wait: scheduleWaitOf(wo), sales: isSalesDoc(wo) }));
    const stamp = (row, wait) => ({ ...row, wait, ready: !wait, status: wait ? 'WAITING' : (row.running ? 'ON THE FLOOR' : 'SCHEDULED') });

    // ◆ Customer orders — each its own row(s): its small parts, and its poles with it.
    const customBatches = [], customPoleBatches = [];
    docs.filter(d => d.sales).forEach(d => {
        const { parts, poles } = d.tracks;
        if (parts && parts.chunks.length) customBatches.push(stamp(priceParts([{ wo: d.wo, track: parts }], 'custom', matrix, T), d.wait));
        if (poles && poles.poles > 0 && !poles.done) customPoleBatches.push(stamp({ ...pricePoles([{ wo: d.wo, track: poles }], 'custom', T), withOrder: true }, d.wait));
    });
    const byDue = (a, b) => {
        if (a.ready !== b.ready) return a.ready ? -1 : 1;
        const x = a.reqDate || '9999-12-31', y = b.reqDate || '9999-12-31';
        return x < y ? -1 : x > y ? 1 : 0;
    };
    customBatches.sort(byDue); customPoleBatches.sort(byDue);

    // ▢ Stock — pooled by recipe, station and the coats left; ready pools apart from the ones waiting on a pick.
    const pool = (list, keyOf) => { const m = new Map(); list.forEach(x => { const k = keyOf(x); (m.get(k) || m.set(k, []).get(k)).push(x); }); return [...m.values()]; };
    const stockParts = docs.filter(d => !d.sales && d.tracks.parts && d.tracks.parts.chunks.length);
    const stockBatches = pool(stockParts, d => [d.wait ? 'W' : 'R', d.wait, d.tracks.parts.key, d.tracks.parts.station, d.tracks.parts.chunks.map(c => signatureOf(c.steps)).join('+'), d.tracks.parts.kept ? d.wo.id : ''].join('|'))
        .map(g => stamp(priceParts(g.map(d => ({ wo: d.wo, track: d.tracks.parts })), 'stock', matrix, T), g[0].wait))
        .sort((a, b) => (a.ready !== b.ready ? (a.ready ? -1 : 1) : b.parts - a.parts));
    const stockPoles = docs.filter(d => !d.sales && d.tracks.poles && d.tracks.poles.poles > 0 && !d.tracks.poles.done);
    const poleBatches = pool(stockPoles, d => [d.wait ? 'W' : 'R', d.wait, d.tracks.poles.key, signatureOf(d.tracks.poles.steps), d.tracks.poles.kept ? d.wo.id : ''].join('|'))
        .map(g => stamp(pricePoles(g.map(d => ({ wo: d.wo, track: d.tracks.poles })), 'stock', T), g[0].wait))
        .sort((a, b) => (a.ready !== b.ready ? (a.ready ? -1 : 1) : b.poles - a.poles));

    // The run order: ready customer orders by due date (an order's poles carry its number), then stock, then stock poles.
    let seq = 0;
    const seqOfWo = new Map();
    customBatches.filter(b => b.ready).forEach(b => { b.seq = ++seq; seqOfWo.set(b.wos[0].id, b.seq); });
    customPoleBatches.filter(b => b.ready).forEach(b => { b.seq = seqOfWo.get(b.wos[0].id) || ++seq; seqOfWo.set(b.wos[0].id, b.seq); });
    [...stockBatches, ...poleBatches].filter(b => b.ready).forEach(b => { b.seq = ++seq; });
    [...customBatches, ...customPoleBatches, ...stockBatches, ...poleBatches].forEach(b => { if (!b.ready) b.seq = null; });

    // Totals count what can run — ready work and what is on the floor now. What waits is listed, never summed.
    const sum = (arr, k) => arr.reduce((s, b) => s + num(b[k]), 0);
    const partsRows = [...customBatches, ...stockBatches].filter(b => b.ready);
    const poleRows = [...customPoleBatches, ...poleBatches].filter(b => b.ready);
    const spinRows = partsRows.filter(b => b.station !== SPRAY_STATIONS.BOOTH), boothRows = partsRows.filter(b => b.station === SPRAY_STATIONS.BOOTH);
    const sledOvenMins = sum(spinRows, 'ovenMins'), boothOvenMins = sum(boothRows, 'ovenMins'), poleOvenMins = sum(poleRows, 'ovenMins');
    const ovenTotalMins = sledOvenMins + boothOvenMins + poleOvenMins;                 // one oven, one bake at a time
    const smallHandMins = sum(partsRows, 'handMins'), poleHandMins = sum(poleRows, 'handMins');
    const totalHandMins = smallHandMins + poleHandMins;
    const handOverlapMins = Math.min(totalHandMins, poleOvenMins);                       // hand work done while poles bake
    const handBeyondMins = Math.max(0, totalHandMins - poleOvenMins);
    const dailyMins = num(opts.dailyMins) || num(timers.activeFloorDailyMinutes) || 480;
    const wallMins = ovenTotalMins + handBeyondMins;
    const waiting = [...customBatches, ...customPoleBatches, ...stockBatches, ...poleBatches].filter(b => !b.ready);

    return {
        batches: [...customBatches, ...stockBatches], customBatches, customPoleBatches, stockBatches, poleBatches,
        totalMachineMins: sum(partsRows, 'machineMins'), totalSleds: sum(spinRows, 'sleds'), totalParts: sum(spinRows, 'parts'),
        boothLoads: sum(boothRows, 'loads'), boothParts: sum(boothRows, 'parts'),
        setupCount: new Set(waiting.flatMap(b => b.wos.map(w => w.id))).size,
        customOrderCount: new Set([...customBatches, ...customPoleBatches].flatMap(b => b.wos.map(w => w.id))).size,
        sledOvenMins, boothOvenMins, poleOvenMins, ovenTotalMins,
        poleCount: sum(poleRows, 'poles'), poleRacks: sum(poleRows, 'racks'), poleSprayMins: sum(poleRows, 'sprayMins'),
        smallHandMins, poleHandMins, totalHandMins, handOverlapMins, handBeyondMins,
        dailyMins, wallMins, days: wallMins / dailyMins,
    };
}
