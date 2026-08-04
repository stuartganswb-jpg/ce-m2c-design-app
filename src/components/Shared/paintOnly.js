// "JUST FOR PAINT" — a paint job for an item the app was never taught (Stuart 2026-08-03).
//
// "we have a lot of older legacy parts in netsuite that we do not want to bother setting up full
// assemblies and we need to use the app for now to just paint emergencies for the next 2 months
// before they are discontinued."
//
// THE SHAPE OF IT. A normal stock build is: library assembly → NetSuite work order → paint →
// pack → assembly build receives finished goods. A JFP run has no library assembly and no NetSuite
// work order, because setting those up for an item being discontinued in two months is the work we
// are avoiding. So the order carries the NetSuite item as TYPED TEXT, flows through the app exactly
// like any other finishing job, and only speaks to NetSuite at the very last step — where the
// assembly build is replaced by a plain inventory adjustment into the bin that was scanned.
//
// WHY IT NEEDS NO CLOUD FUNCTION CHANGE: onStockBuildDone gates on `!after.nsWoId`. A JFP order has
// no NetSuite work order to complete, so that trigger skips it on its own and the adjustment is
// queued client-side through the same ns_outbox every other write uses. Nothing to deploy.
//
// THE ITEM IS VALIDATED WHEN IT IS TYPED, not at packing. The whole point is that the operator is
// typing a code the app has never seen — so it is resolved against NetSuite at creation, when the
// person who knows the item is still standing there. Discovering it at the put-away bin, two weeks
// and one paint line later, would be the worst possible moment.
//
// RECORD CLASS: the template stays a Master Assembly (Stuart: "whatever you think is best"). It is
// not a Fee — a fee has no physical item and this produces physical painted goods — and it is not
// Inventory, because the template is never stocked or picked. What actually marks it is the
// explicit flag below, so the class can change without breaking anything.

// The template item in the Master Library. Declared by flag; the code is a fallback so the record
// Stuart already made works without being edited first.
export const PAINT_ONLY_CODE = 'JFP';
export const isPaintOnlyPart = (part) => {
    if (!part) return false;
    if (part.manufacturingSpecs && part.manufacturingSpecs.paintOnlyTemplate === true) return true;
    return String(part.legacyErpId || part.itemId || '').trim().toUpperCase() === PAINT_ONLY_CODE;
};

// An ORDER raised from that template. Never inferred from the code — a work order says so itself,
// because by the time it reaches packing the library record is not in the room.
export const isPaintOnlyOrder = (wo) => !!(wo && wo.paintOnly === true);

const clean = (v) => String(v ?? '').trim();

// NetSuite item ids are typed by hand here. Upper-cased and trimmed so 'h1-138be ' matches, but
// nothing else is assumed about the format — these are legacy codes with no grammar we control.
export const normalizeItemCode = (v) => clean(v).toUpperCase();

/**
 * Is this run describable? Returns { ok, error } — error is the sentence shown to the operator.
 * Quantity must be a positive whole number: half a painted part is not a thing.
 */
export function validatePaintOnlyRun({ itemCode, finishId, qty }) {
    if (!normalizeItemCode(itemCode)) return { ok: false, error: 'Enter the NetSuite item # — this is the item the finished pieces get adjusted into.' };
    if (!clean(finishId)) return { ok: false, error: 'Choose the in-house finish. It sets the recipe the floor will run.' };
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return { ok: false, error: 'Enter a whole quantity of 1 or more.' };
    return { ok: true, error: '' };
}

// What the floor, the packer and the NetSuite memo all read. The item code leads because that is
// the only identity this job has — there is no assembly behind it.
export function paintOnlyDescription({ itemCode, finishLabel, qty, note }) {
    const parts = [normalizeItemCode(itemCode)];
    if (clean(finishLabel)) parts.push(clean(finishLabel));
    if (Number(qty) > 0) parts.push(`×${Number(qty)}`);
    const head = parts.join(' · ');
    return clean(note) ? `${head} — ${clean(note)}` : head;
}

// The label on every screen that shows one of these, so nobody mistakes it for a real assembly.
export const PAINT_ONLY_BADGE = 'JUST FOR PAINT';

/**
 * The NetSuite inventory adjustment that closes a JFP run out — a straight positive receipt of the
 * painted pieces into the bin the packer actually scanned.
 *
 * Deliberately mirrors the pack-scrap adjustment already in WMS (same account 254, same
 * inventoryDetail shape) rather than inventing a second way to move stock. Pure so the payload can
 * be asserted without NetSuite in the room.
 */
export function paintOnlyAdjustment({ itemId, qty, bin, subsidiary, location, ref, itemCode, by }) {
    const n = Math.max(0, Math.floor(Number(qty) || 0));
    const b = normalizeItemCode(bin);
    const useBin = b && b !== 'UNASSIGNED';
    return {
        account: { id: '254' },
        subsidiary: { id: String(subsidiary) },
        memo: `JFP paint run ${ref || ''} — ${normalizeItemCode(itemCode)} ×${n}${by ? ` (${by})` : ''}`.trim(),
        inventory: {
            items: [{
                item: { id: String(itemId) },
                location: { id: String(location) },
                adjustQtyBy: n,
                // Without a bin NetSuite still takes the adjustment; it just lands unbinned. The
                // caller warns rather than blocking, because the paint is already done either way.
                ...(useBin ? { inventoryDetail: { quantity: n, inventoryAssignment: { items: [{ binNumber: { refName: b }, quantity: n }] } } } : {}),
            }],
        },
    };
}
