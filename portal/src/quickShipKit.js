// A TRAVERSE KIT ON THE PORTAL'S QUICK SHIP, WORKED OUT ON THE PAGE (Stuart 2026-10-20: "add and align — a kit can be sold, kit + additional
// per foot price in __ finish"). Tab 7's own files, run over what portalStock served for this customer: the kit and feet lines
// (Shared/traverseKitSale.traverseKitLinesOf), the components panel and its lines (Shared/traverseConfigurator, traverseComponentLinesOf),
// what the track still needs (Shared/traverseDraw). What the page shows is a preview — the request sends the ANSWERS, and the server
// re-checks and re-prices them with the same files (functions/index.js trvEntryOf); tab 7's "Load into cart" rebuilds the lines from them.
import { traverseKitLinesOf, traverseComponentLinesOf } from '@engine/traverseKitSale.js';
import { configuratorOffer, configuratorLines, defaultPicks } from '@engine/traverseConfigurator.js';
import { DRAWS, MOTOR_SIDES, traverseAnswersMissing } from '@engine/traverseDraw.js';

// The fields Shared/traverseKitSale reads off a kit, from the served kit (only this customer's own codes and prices are in it).
export const kitRecordOf = (k) => ({ id: k.id, legacyErpId: k.code, itemName: k.name, manufacturingSpecs: {
  kitAlign: { drive: k.drive, setup: k.setup, frontRail: k.frontRail, minFeet: k.minFeet },
  kitMotorCodes: (k.motors || []).map((m) => ({ motorItem: m.motorItem, code: m.code, fabSku: m.kitSku, net: m.rate })) } });
// …and their pricing row's two fields it reads: their kit code and their per-foot price.
export const kitRowOf = (k) => ({ clientSku: k.sku, perFootPrice: k.perFoot });

// The components panel's opening answers — tab 7's popup: end stops 2 per track, the chart's included picks at this length, nothing chosen.
export const openingSel = (chart, cfg) => ({ carrierStyle: '', carrierQty: '', draw: '', motorSide: '',
  picks: chart ? defaultPicks({ rules: chart, drive: cfg.drive, feet: cfg.feet, trackCount: cfg.trackCount }) : {}, accessories: {} });
// A new length keeps what does not depend on it (the draw, the motor side, the carrier style, the accessories) and opens the rest again
// at the chart's counts for that length — what tab 7's popup would open with there.
export const selAtNewLength = (sel, chart, cfg) => (sel ? { ...sel, carrierQty: '', picks: openingSel(chart, cfg).picks } : null);

// What the track still needs (CPQ's words — said, never refused): the draw, the motor side on a motor, a carrier style.
export const stillOf = (cfg, sel) => [...traverseAnswersMissing({ drive: cfg.drive, sel }), ...(sel && sel.carrierStyle ? [] : ['carrier style'])];

// The panel's view (./TraversePanel): every choice the chart offers for this drive and billed length, each part with its name, THEIR number
// and their price.
export function panelViewOf({ chart, cfg, items = {}, sel }) {
  if (!chart) return null;
  const offer = configuratorOffer({ rules: chart, drive: cfg.drive, feet: cfg.feet });
  const part = (id) => { const i = items[id] || {}; return { id, name: i.name || id, sku: i.sku || '', unit: Number(i.rate) > 0 ? Number(i.rate) : null }; };
  return {
    drive: cfg.drive, feet: cfg.feet, tracks: cfg.trackCount,
    draws: DRAWS.map((d) => ({ value: d.value, label: d.label, hint: d.hint })),
    motorSides: cfg.drive === 'MOTORIZED' ? MOTOR_SIDES.map((m) => ({ value: m.value, label: m.label })) : [],
    carrierStyles: offer.carrierStyles.map((c) => ({ ...part(c.itemId), label: c.label, included: c.includedQty, defaultQty: c.defaultQty })),
    picks: offer.picks.map((p) => ({ ...part(p.itemId), included: p.includedQty, endStop: /ENDSTOP/i.test(p.itemId) })),
    accessories: offer.accessories.map((a) => part(a.itemId)),
    missing: stillOf(cfg, sel),
  };
}

/** Tab 7's kit and feet lines for these answers (Shared/traverseKitSale.traverseKitLinesOf): { error } | { kitLine, feetLine, cfg }. */
export const kitLinesOf = ({ k, finish = '', proj = '', motorItem = '', feet = '' }) => (k
  ? traverseKitLinesOf({ kit: kitRecordOf(k), row: kitRowOf(k), finish, proj, motorItem, feet }) : { error: 'Pick a kit.' });
/** The customer's own panel answers as they stand at this billed length: given at another length, the length-bound ones open again. */
export const answersAt = (mine, chart, cfg) => (!mine ? null : mine.at === cfg.feet ? mine.answers : selAtNewLength(mine.answers, chart, cfg));

/**
 * The kit as it would go on the request: { error } until its questions are answered, else the lines tab 7 writes for it — their complete kit,
 * "Additional foot · <finish>" × the feet above the minimum charge, the components — with the answers the request sends.
 * `sel` null = the panel's opening answers.
 */
export function kitOrderOf({ k, finish = '', proj = '', motorItem = '', feet = '', sel = null, chart = null, items = {} }) {
  const out = kitLinesOf({ k, finish, proj, motorItem, feet });
  if (out.error) return { error: out.error };
  const cfg = out.cfg;
  const answers = chart ? (sel || openingSel(chart, cfg)) : null;
  const cfgLines = answers ? configuratorLines({ rules: chart, drive: cfg.drive, feet: cfg.feet, sel: answers, priceOf: (id) => Number((items[id] || {}).rate) || 0 }) : [];
  const { lines: parts, missing } = traverseComponentLinesOf({ cfgLines, cfg,
    findItem: (code) => (items[code] ? { id: code, legacyErpId: code, itemName: items[code].name || code } : null),
    rowOf: (it) => ({ clientSku: (items[it.id] || {}).sku || '' }) });
  const line = (l, rate) => ({ code: l.aliasErp || l.erp, name: l.name, note: l.note, qty: l.qty, rate: Math.round((Number(rate) || 0) * 100) / 100 });
  const lines = [
    line(out.kitLine, out.kitLine.rateOverride != null ? out.kitLine.rateOverride : k.rate),
    ...(out.feetLine ? [line(out.feetLine, out.feetLine.rateOverride)] : []),
    ...parts.map((p) => line({ aliasErp: p.opts.aliasErp, erp: p.item.legacyErpId, name: p.item.itemName, note: p.note, qty: p.qty }, p.opts.rateOverride)),
  ];
  return {
    cfg, sel: answers, lines, missing, still: chart ? stillOf(cfg, answers) : [],
    total: Math.round(lines.reduce((n, l) => n + l.rate * l.qty, 0) * 100) / 100,
    entry: { kitId: k.id, finish: out.kitLine.trvFinish, proj: out.kitLine.trvProj || '', motorItem: out.kitLine.trvMotor || '', feet: Math.max(parseInt(feet, 10) || 4, 1), sel: answers },
  };
}
