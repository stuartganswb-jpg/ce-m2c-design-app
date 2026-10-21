// WHAT THE FLOOR IS TOLD ABOUT ONE TRAVERSE — its draw, the motor side on a motorised track, and the carriers loaded onto it (Stuart
// 2026-10-21: "lets fix that draw direction, that data ultimately needs to flow to the traverse station" · "it should present them with
// example 'Left Draw, 72 carriers needed'" · "the traverse cut sheet header as well").
//
// The doors ASK it (CPQ's Traverse components step; tab 7's components popup, and a portal kit loaded into tab 7) and say "still needed"
// when it is not answered — never refused. This module carries what was answered from the order to the floor:
//   TAB 7   the kit's line keeps it (009be920); at save every part line of the kit on the sales order takes the stamp — the lines the
//           traverse station reads, and the lines an Order Entry row's shop cut list is made from (Shared/rowPairShape).
//   CPQ     at save the configuration's ▶ header row takes the stamp; Shared/partFacts carries it onto every row under the header, the
//           way it carries "Line n · Room", and RTG's split already spreads those line facts onto the finishing documents' parts lists
//           and the shop cut list — RTG's own file is not touched.
// Read by the WMS traverse station (PickPack/TraverseStationTab) and the shop's Traverse Cut Sheet header (ShopFloor). Display orders
// typed on 10.5 ask no draw and carry none (Stuart: "display orders do not worry").
// HQ only: the portal's engine copy (scripts/sync-engine.mjs) does not include this file.
import { drawLabel, MOTOR_SIDES } from './traverseDraw.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** The fields of the stamp, the one list every writer that builds a line field by field copies. */
export const TRACK_FACT_FIELDS = ['traverseLine', 'traverseName', 'traverseDraw', 'traverseMotorSide', 'traverseCarriers'];

/**
 * The carriers loaded onto the track: the chosen carrier style's lines of the components step (Shared/traverseConfigurator
 * .configuratorLines — the included ones and any above the chart, the count the order carries). null when no carrier style was chosen.
 */
export function carriersOnTrackOf({ sel = null, lines = [] } = {}) {
    const style = U(sel && sel.carrierStyle);
    if (!style) return null;
    return (Array.isArray(lines) ? lines : []).filter(l => l && U(l.code) === style).reduce((n, l) => n + (Number(l.qty) || 0), 0);
}

/**
 * The stamp a line of one traverse carries. `id` keeps the traverse's lines together (tab 7: the kit's cart key; CPQ: the cart line's
 * id); `name` is how the floor names it where no Line n names it (tab 7: their kit code).
 */
export function trackFactsOf({ id = '', name = '', draw = '', motorSide = '', carriers = null } = {}) {
    const d = U(draw), m = U(motorSide), c = carriers == null || carriers === '' ? NaN : Number(carriers);
    return {
        traverseLine: String(id || 'TRAVERSE'),
        ...(String(name || '').trim() ? { traverseName: String(name).trim() } : {}),
        ...(d ? { traverseDraw: d } : {}),
        ...(m ? { traverseMotorSide: m } : {}),
        ...(Number.isFinite(c) ? { traverseCarriers: c } : {}),
    };
}

/**
 * CPQ: a cart line's stamp for its ▶ header at save — {} when it is not a traverse (no components step, no answers). The draw and the
 * motor side as the line keeps them (top level, else engineConfig.trvSel); the carriers from its components.
 */
export function cpqTrackFactsOf(item) {
    if (!item) return {};
    const ec = item.engineConfig || {};
    const sel = ec.trvSel && typeof ec.trvSel === 'object' ? ec.trvSel : null;
    const comps = Array.isArray(item.trvComponents) ? item.trvComponents : [];
    if (!sel && !comps.length && !item.traverseDraw) return {};
    return trackFactsOf({ id: item.id, draw: item.traverseDraw || (sel && sel.draw), motorSide: item.traverseMotorSide || (sel && sel.motorSide),
        carriers: carriersOnTrackOf({ sel, lines: comps }) });
}

/**
 * TAB 7: a traverse kit's stamp for its part lines on the sales order, from the kit's cart line (the draw and motor side its components
 * popup asked — Shared/traverseKitSale.withTraverseAnswers — and the carriers tab 7 counted then). Named by our kit code and its feet.
 */
export function kitTrackFactsOf(kitLine) {
    if (!kitLine) return {};
    const sel = kitLine.trvSel && typeof kitLine.trvSel === 'object' ? kitLine.trvSel : null;
    const code = String(kitLine.trvKitCode || kitLine.erp || '').trim();
    return trackFactsOf({ id: kitLine.key, name: code ? `${code}${Number(kitLine.trvFeet) > 0 ? ` · ${Number(kitLine.trvFeet)} ft` : ''}` : '',
        draw: kitLine.traverseDraw || (sel && sel.draw), motorSide: kitLine.traverseMotorSide || (sel && sel.motorSide), carriers: kitLine.traverseCarriers });
}

/** A line's stamp as it is — the fields present, nothing else — for a writer that copies a line field by field; {} when it has none. */
export const trackFactsFrom = (line) => (line && line.traverseLine
    ? Object.fromEntries(TRACK_FACT_FIELDS.filter(k => line[k] !== undefined && line[k] !== null && line[k] !== '').map(k => [k, line[k]]))
    : {});

const motorWords = (m) => (MOTOR_SIDES.find(x => x.value === U(m)) || {}).label || '';
/**
 * What the station and the cut sheet say for one traverse: "One way left, 72 carriers needed" · "Center draw, Motor right, 64 carriers
 * needed" · "Draw not recorded — ask the office, 72 carriers needed". The draw in the words every screen of the order uses
 * (Shared/traverseDraw.DRAWS — the arrow on the take-off).
 */
export function trackFactsWords(f = {}) {
    const draw = drawLabel(f.traverseDraw);
    const parts = [draw || 'Draw not recorded — ask the office'];
    const motor = motorWords(f.traverseMotorSide);
    if (motor) parts.push(motor);
    const c = Number(f.traverseCarriers);
    if (f.traverseCarriers !== undefined && f.traverseCarriers !== null && Number.isFinite(c)) parts.push(c > 0 ? `${c} carrier${c === 1 ? '' : 's'} needed` : 'no carriers on the order');
    return parts.join(', ');
}

/**
 * The traverses among some lines — a sales order's lines, a document's parts list or cut list — one per traverse, in the order first
 * met: [{ id, label, facts, drawn }]. Named by the kit (tab 7) or by its line ("Line 2 · Living Room", a CPQ document); `drawn` = a
 * draw was recorded.
 */
export function traversesOf(lines = []) {
    const by = new Map();
    (Array.isArray(lines) ? lines : []).forEach(l => {
        if (!l || !l.traverseLine) return;
        const id = String(l.traverseLine);
        if (by.has(id)) return;
        const facts = trackFactsFrom(l);
        const n = Number(l.lineNo) || 0;
        const label = facts.traverseName || (n > 0 ? `Line ${n}${l.lineTag ? ` · ${l.lineTag}` : ''}` : 'Traverse');
        by.set(id, { id, label, facts, drawn: !!facts.traverseDraw });
    });
    return [...by.values()];
}
