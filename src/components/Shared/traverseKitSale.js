// SELLING A TRAVERSE KIT ON QUICK SHIP — the kit, its finish, the projection a single needs, the motor on a motorised kit, the length:
// the customer's COMPLETE KIT line (their code, their per-motor price) and "Additional foot · <finish>" × the feet above the base set at
// their per-foot price (Stuart 2026-10-20: "a kit can be sold, kit + additional per foot price in __ finish"), then the components.
// Tab 7's own sale (HQ/QuickShipTab.js "Traverse kits", addTraverse, applyTrvComponents), moved word for word so the customer portal's
// Quick Ship sells a kit exactly as Order Entry does, and tab 7's "Load into cart" rebuilds a portal kit order through the same lines. Pure.
import { resolveKitCode } from './kitCode.js';
import { singleProjections, projLabel } from './traverseExplode.js';
import { configuratorLines } from './traverseConfigurator.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * The kits a customer may buy: a Kit-class record carrying kitAlign AND a pricing row for this customer (`rowOf`) — the same entitlement
 * rule as every Quick Ship item. Dropdown order (Stuart 2026-08-13): all MANUAL first — wall, double, ceiling — then the same shape again
 * for MOTORIZED, so the CSR's eye lands where the PO does.
 */
export function traverseKitsOf(items = [], rowOf = () => null) {
    const rank = (k) => {
        const a = k.manufacturingSpecs.kitAlign;
        const drive = String(a.drive).toUpperCase() === 'MOTORIZED' ? 1 : 0;
        const mount = String(a.mount).toUpperCase() === 'CEILING' ? 1 : 0;
        const setup = String(a.setup).toUpperCase() !== 'DOUBLE' ? 0 : (String(a.frontRail).toUpperCase() === 'RING' ? 2 : 1);
        const mat = { P: 0, EP: 1, W: 2 }[String(a.material).toUpperCase()] ?? 3;
        return drive * 1000 + mount * 100 + setup * 10 + mat;
    };
    return (items || []).filter(p => p.partClass === 'Kit' && p.manufacturingSpecs?.kitAlign && rowOf(p))
        .sort((x, y) => rank(x) - rank(y));
}

/**
 * A code the customer gave — their pattern # (clientSku), a per-motor code of theirs, our code or our per-motor code — to the kit and the
 * motor it names. @returns { kit, motorItem } | null
 */
export function traverseKitByCode(kits = [], code = '', rowOf = () => null) {
    const c = String(code || '').trim().toUpperCase();
    const bySku = kits.find(k => { const r = rowOf(k); return r && String(r.clientSku || '').trim().toUpperCase() === c; })
        || kits.find(k => (k.manufacturingSpecs.kitMotorCodes || []).some(x => String(x.fabSku || '').trim().toUpperCase() === c));
    if (bySku) {
        const mc = (bySku.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.fabSku || '').trim().toUpperCase() === c);
        return { kit: bySku, motorItem: (mc && mc.motorItem) || '' };
    }
    const r = resolveKitCode(kits, c);
    return r ? { kit: r.kit, motorItem: r.motorItem || '' } : null;
}

/**
 * The finishes a kit's material accepts: the kit's own finish MATRIX wins (4.6 Kit Builder checkboxes, Stuart 2026-08-13: "just check off
 * which apply"); the material rules are the fallback for kits nobody has curated — /EP kits take the outsourced plated codes, /P kits the
 * in-house paints, /W kits the S-stains. `finishList` = [{ code, outsourced, … }].
 */
export function traverseKitFinishesOf(kit, finishList = []) {
    const allowed = (kit?.manufacturingSpecs?.kitFinishOptions || []).map(c => String(c).toUpperCase());
    if (allowed.length) return finishList.filter(f => allowed.includes(f.code));
    const mat = String(kit?.manufacturingSpecs?.kitAlign?.material || '').toUpperCase();
    if (!mat) return [];
    if (mat === 'EP') return finishList.filter(f => f.outsourced);
    if (mat === 'W') return finishList.filter(f => /^S/.test(f.code));
    return finishList.filter(f => !f.outsourced && /^P/.test(f.code));
}

// A DOUBLE has no projection to ask about — one bracket carries both rods, and every double part is tagged proj:any. So the question
// appears on singles and nowhere else.
export const traverseKitIsSingle = (kit) => !!kit && String(kit.manufacturingSpecs?.kitAlign?.setup || '').toUpperCase() !== 'DOUBLE';
export const traverseKitProjectionsOf = (kit) => (traverseKitIsSingle(kit)
    ? singleProjections(kit?.manufacturingSpecs?.kitFamily || 'H1-2TRV', kit?.manufacturingSpecs?.kitAlign?.bracketStyle || '') : []);
/** The traverse chart a kit reads: system/traverse_rules_<family>. */
export const traverseKitFamilyOf = (kit) => String(kit?.manufacturingSpecs?.kitFamily || '').trim().toUpperCase() || 'H1-2TRV';

/**
 * The kit's two lines — THE LINE IS THEIR COMPLETE KIT (Stuart 2026-08-13: "the in app forms should resolve to the finished fabricut kits
 * that include the motor upgrade to match their complete kit code"): a motor folds INTO the kit line at their per-motor code and price,
 * never a separate upgrade line; 4 ft is the MINIMUM CHARGE (a shorter cut still bills the set); the feet above it are one line at their
 * per-foot price. NO NetSuite identity by design (the SO push consumes exploded components plus a generic traverse $-holder). The
 * projection rides the LINE: the same kit sells at any of the three depths.
 * @returns { error } | { kitLine, feetLine | null, cfg }   (lines without their `key` — the screen gives each its own)
 */
export function traverseKitLinesOf({ kit, row = null, finish = '', proj = '', motorItem = '', feet = '' } = {}) {
    if (!kit) return { error: "Pick a kit (or paste one of the customer's kit codes)." };
    if (!finish) return { error: 'Pick the finish — the shop cannot build "painted" without knowing WHICH paint.' };
    // A single at the wrong depth is the wrong bracket ITEM, not a note on the order — so the question is answered before the line exists.
    if (traverseKitIsSingle(kit) && !proj) return { error: 'Pick the projection — a single sells at three depths and each one is a different bracket.' };
    const align = kit.manufacturingSpecs.kitAlign;
    const ft = Math.max(parseInt(feet) || 4, 1);
    const billFeet = Math.max(ft, align.minFeet || 4);
    const mc = String(align.drive).toUpperCase() === 'MOTORIZED' && motorItem
        ? (kit.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.motorItem).toUpperCase() === String(motorItem).toUpperCase())
        : null;
    const theirSku = mc?.fabSku || row?.clientSku || '';
    const mcNet = mc && Number.isFinite(parseFloat(mc.net)) ? parseFloat(mc.net) : null;
    const kitCode = mc?.code || kit.legacyErpId;
    const kitLine = {
        itemId: kit.id, erp: mc?.code || kit.legacyErpId, nsId: '', name: kit.itemName || kit.legacyErpId,
        aliasErp: theirSku, aliasItemId: null,
        qty: 1, note: `${ft}ft system — 4ft set${ft < billFeet ? ' (min charge)' : ''} · ${finish}${proj ? ` · ${projLabel(proj)}` : ''}${mc ? ` · ${motorItem}` : ''}`,
        bin: '', packUom: '', packSize: 1,
        rateOverride: mcNet, // per-motor kits price at THEIR number; base kits price from the row (null → the screen's rate)
        kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
        trvFinish: finish, trvProj: proj, trvMotor: mc ? motorItem : '', trvFeet: billFeet, trvKitCode: kitCode,
    };
    const extra = billFeet - (align.minFeet || 4);
    const perFoot = parseFloat(row?.perFootPrice);
    const feetLine = extra > 0 ? {
        itemId: kit.id, erp: mc?.code || kit.legacyErpId, nsId: '', name: kit.itemName || kit.legacyErpId,
        aliasErp: theirSku, aliasItemId: null,
        qty: extra, note: `Additional foot · ${finish}`,
        bin: '', packUom: '', packSize: 1,
        rateOverride: Number.isFinite(perFoot) ? perFoot : 0,
        kitKey: null, kitName: null, kitBrand: null, kitFinish: '',
        trvFinish: finish, trvProj: proj, trvKitCode: kitCode, trvIsFeet: true,
    } : null;
    // The components configurator opens NOW — required at checkout, and this IS checkout for a kit order.
    const cfg = { drive: String(align.drive).toUpperCase(), feet: billFeet, kitCode, finish,
        trackCount: String(align.setup).toUpperCase() === 'DOUBLE' && String(align.frontRail).toUpperCase() !== 'RING' ? 2 : 1 };
    return { kitLine, feetLine, cfg };
}

/**
 * The components as Quick Ship lines (tab 7's applyTrvComponents): every line a REAL library item (they consume inventory) — included lines
 * ride rate 0, billables at the customer's price; both push as real NetSuite lines, so no special casing downstream.
 * @returns { lines: [{ item, qty, note, opts }], missing }   (`opts` is what tab 7's pushLine takes)
 */
export function traverseComponentLinesOf({ cfgLines = [], findItem = () => null, rowOf = () => null, cfg = null } = {}) {
    const lines = [];
    let missing = 0;
    cfgLines.forEach(cl => {
        const it = findItem(cl.code);
        if (!it) { missing++; return; }
        const row = rowOf(it);
        lines.push({ item: it, qty: cl.qty, note: `${cl.why}${cfg?.finish ? ` · ${cfg.finish}` : ''} [${cfg?.kitCode || 'traverse'}]`,
            opts: { noPack: true, rateOverride: cl.billable ? cl.rate : 0, aliasErp: row?.clientSku || '', trvOfKit: cfg?.kitCode || 'traverse' } });
    });
    return { lines, missing };
}

/**
 * A traverse kit ordered on the portal — its ANSWERS (kit, finish, projection, motor, feet and the components' selection) — rebuilt as the
 * lines tab 7 would have written for them: the kit line, the feet line, and the components (configuratorLines over the kit's own chart at
 * the billed feet, priced by `priceOf`). The one rebuild the portal's server prices the request with and tab 7's "Load into cart" fills the
 * cart with. @returns { error } | { kit, kitLine, feetLine, cfg, cfgLines, components, missing }
 */
export function traverseKitOrderOf(entry = {}, { kits = [], rowOf = () => null, finishList = [], rulesOf = () => null, findItem = () => null, priceOf = () => 0 } = {}) {
    const kit = kits.find(k => k.id === entry.kitId) || null;
    if (!kit) return { error: 'This kit is not one this account can order.' };
    if (!traverseKitFinishesOf(kit, finishList).some(f => U(f.code) === U(entry.finish))) return { error: `${kit.legacyErpId} is not sold in ${entry.finish || 'that finish'}.` };
    // (the depth as tab 7's own select holds it — the option's inches as text)
    const projOpt = traverseKitIsSingle(kit) ? traverseKitProjectionsOf(kit).find(p => Math.abs(Number(p.inches) - Number(entry.proj)) < 0.01) : null;
    if (traverseKitIsSingle(kit) && !projOpt) return { error: 'Pick the projection — a single sells at three depths and each one is a different bracket.' };
    const motors = kit.manufacturingSpecs.kitMotorCodes || [];
    const motor = entry.motorItem ? motors.find(x => U(x.motorItem) === U(entry.motorItem)) : null;
    if (entry.motorItem && !motor) return { error: `${kit.legacyErpId} does not take that motor.` };
    const finish = (traverseKitFinishesOf(kit, finishList).find(f => U(f.code) === U(entry.finish)) || {}).code;
    const out = traverseKitLinesOf({ kit, row: rowOf(kit), finish, proj: projOpt ? String(projOpt.inches) : '', motorItem: motor ? motor.motorItem : '', feet: entry.feet });
    if (out.error) return out;
    const rules = rulesOf(traverseKitFamilyOf(kit));
    const cfgLines = rules && entry.sel ? configuratorLines({ rules, drive: out.cfg.drive, feet: out.cfg.feet, sel: entry.sel, priceOf }) : [];
    const { lines: components, missing } = traverseComponentLinesOf({ cfgLines, findItem, rowOf, cfg: out.cfg });
    return { kit, ...out, cfgLines, components, missing };
}
