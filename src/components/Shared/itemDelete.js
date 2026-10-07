// ─────────────────────────────────────────────────────────────────────────────────────────────
// A TRUE DELETE OF A LIBRARY ITEM — what may go, and what must go with it (Stuart 2026-10-06)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "i need you to add a delete tool to 4.5, it needs to be a true delete so that it totally removes the item
//  from the database so that when we resync later if the same netsuite internal id is used, it will be like a
//  new item in the app." · a used item: "refuse" · "once we delete an item, if we sync and by chance the
//  netsuite id had existed before it comes in as if new, does not recall any old data" · "can delete assembly
//  but as always ask to confirm if used anywhere in cpq flow, etc."
//
// The 11.1 item sync finds an item by its record (Approved_Designs/<BRAND>-INV-<internal id>) and never
// overwrites what the app owns on one it already has. So the record has to be GONE for a re-import to start
// clean — and so has everything else in the database that is keyed to that record and would meet the new one:
//
//      assembly_pins where assemblyId = the record   an assembly's OWN bill-of-materials lines (the sync writes
//                                                    them as PIN-<record id>-<component> and MERGES into what is there)
//      system/ns_import_diffs/items/<record id>      the "NetSuite differs" rows and the remembered "keep the app's"
//      system/retired_items.internalIds              the locked OLD list, by NetSuite internal id
//      global_assets[].associatedParts               gallery pictures linked to the record id (the picture stays)
//
// And a record the app's own configuration still names is REFUSED, never deleted out from under it: a line on
// ANOTHER assembly's bill of materials, a CPQ flow (naming it, or one of its bill-of-materials lines), a kit, an
// alias, another item's material twin or species item. A reference by RECORD ID always holds the record; a
// reference by NUMBER (its item number, or its NetSuite id) holds it only when no other record would carry that
// number afterwards — a duplicate may go, the survivor answers for the number.
//
// The deletion ledger (hq_deletion_log) keeps a copy of what was deleted. Nothing reads it back into an item:
// its two readers (RTG's ledger, the Audit Log) only list it.
//
// Not checked, and said so on the confirmation: quotes, sales orders, work orders and saved carts. Lines already
// written keep their text; a screen that looks the item up again will not find it.
//
// The deciding is pure (planItemDelete, residualsOf, deleteChunks); the one writer, applyItemDelete, is handed
// Firestore's functions. Harness: scripts/itemDelete.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const BLANK = new Set(['', 'PENDING', 'N/A']);

/** Where a record id or a number names a part — at any depth of a pin, a flow or another item. */
export const REF_KEYS = ['partId', 'partIds', 'assemblyId', 'linkedAssemblyId', 'linkedItemId', 'aliasOf'];

/** The item's own number ('' when it has none worth matching on). */
export const itemNumberOf = (part) => {
    const erp = U(part && part.legacyErpId);
    const code = !BLANK.has(erp) ? erp : U(part && part.itemId);
    return BLANK.has(code) ? '' : code;
};

// Every number a record answers to: its item number and its NetSuite id (a synced BOM line names a component
// by NetSuite id when the component was not in the library yet).
const numbersOf = (part) => [...new Set([itemNumberOf(part), U(part && part.netSuiteInternalId)].filter(Boolean))];

/** How a record is named to a person: "H1-1BBS — 1\" Brass Basic Bracket". */
export const itemLabelOf = (part) => {
    const code = itemNumberOf(part) || String((part && part.id) || '');
    const name = String((part && part.itemName) || '').trim();
    return name ? `${code} — ${name}` : code;
};

// Every value held at one of `keys`, at any depth: [{ key, value, path }]. Long strings (pictures, drawings)
// and anything past a sane depth are skipped.
function refsIn(node, keys, path = '', out = [], depth = 0) {
    if (node == null || depth > 14) return out;
    if (Array.isArray(node)) { node.forEach((v, i) => refsIn(v, keys, `${path}[${i}]`, out, depth + 1)); return out; }
    if (typeof node !== 'object') return out;
    Object.keys(node).forEach(key => {
        const v = node[key];
        const here = path ? `${path}.${key}` : key;
        if (keys.includes(key)) {
            (Array.isArray(v) ? v : [v]).forEach(x => {
                if ((typeof x === 'string' || typeof x === 'number') && String(x).length <= 200) out.push({ key, value: U(x), path: here });
            });
        }
        if (v && typeof v === 'object') refsIn(v, keys, here, out, depth + 1);
    });
    return out;
}

// The two item tags that name another item by NUMBER.
function tagRefsOf(item) {
    const cd = (item && item.manufacturingSpecs && item.manufacturingSpecs.customData) || {};
    const out = [];
    (Array.isArray(cd.materialTwins) ? cd.materialTwins : []).forEach(t => {
        if (t && t.code) out.push({ key: 'materialTwin', value: U(t.code), detail: U(t.material) });
    });
    const sm = cd.speciesMap;
    if (sm && typeof sm === 'object' && !Array.isArray(sm)) {
        Object.keys(sm).forEach(sfx => { if (sm[sfx]) out.push({ key: 'speciesMap', value: U(sm[sfx]), detail: sfx }); });
    }
    return out;
}

const stepLabelOf = (s, i) => String((s && (s.title || s.name || s.label || s.question)) || `step ${i + 1}`).trim();
const flowLabelOf = (f) => String((f && (f.name || f.title || f.flowName)) || (f && f.id) || 'a flow').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * What of the ticked records may be deleted, what goes with them, and what holds the rest.
 *
 * @param selectedIds  the ticked record ids
 * @param items        EVERY Approved_Designs record, every brand ({ id, ... })
 * @param pins         every assembly_pins record ({ id, assemblyId, partId, ... })
 * @param flows        every cpq_flows record ({ id, ... })
 * @returns {
 *   deletable:    [part]                             — may go
 *   lines:        { [record id]: [pin] }             — a deletable assembly's OWN bill-of-materials lines; they go with it
 *   refused:      [{ part, uses: [text] }]           — held, and by what
 *   variantsLeft: [{ part, variants: [part] }]       — finish variants (<number>/…) of a deletable item that stay
 *   missing:      [id]                               — ticked, no longer in the library
 * }
 */
export function planItemDelete({ selectedIds, items, pins, flows }) {
    const all = Array.isArray(items) ? items.filter(p => p && p.id) : [];
    const byId = new Map(all.map(p => [U(p.id), p]));
    const picked = [...new Set((selectedIds || []).map(String))];
    const targets = picked.map(id => byId.get(U(id))).filter(Boolean);
    const missing = picked.filter(id => !byId.has(U(id)));
    const targetById = new Map(targets.map(p => [U(p.id), p]));
    const targetsByNumber = new Map();
    targets.forEach(p => numbersOf(p).forEach(n => targetsByNumber.set(n, [...(targetsByNumber.get(n) || []), p])));
    const wanted = (v) => targetById.has(v) || targetsByNumber.has(v);

    // Every place something names a ticked record:
    //   { from, value, text }   from = the record that goes away WITH the reference (the item naming it, or the
    //                            assembly whose line it is) — null for a flow · numberOnly = named by number, never by id
    const edges = [];
    const ownLines = new Map();         // a ticked record's id → its own BOM lines (assemblyId IS the record id)
    const filedByNumber = new Map();    // a ticked record's NUMBER → BOM lines filed under it instead of its id
    const pinOwner = new Map();         // pin id → the ticked assembly it is a line of
    (pins || []).forEach(pin => {
        if (!pin) return;
        const asm = U(pin.assemblyId);
        const owner = byId.get(asm) || null;
        if (owner && targetById.has(asm)) {
            ownLines.set(owner.id, [...(ownLines.get(owner.id) || []), pin]);
            if (pin.id) pinOwner.set(U(pin.id), owner);
        } else if (asm && targetsByNumber.has(asm)) filedByNumber.set(asm, (filedByNumber.get(asm) || 0) + 1);
        refsIn(pin, REF_KEYS).forEach(r => {
            if (!wanted(r.value) || (r.path === 'assemblyId')) return;
            edges.push({ from: owner ? owner.id : null, value: r.value, text: `on the bill of materials of ${owner ? itemLabelOf(owner) : (pin.assemblyId || 'an assembly')}` });
        });
    });
    filedByNumber.forEach((n, number) => edges.push({ from: null, value: number, numberOnly: true,
        text: `${plural(n, 'bill-of-materials line is', 'bill-of-materials lines are')} filed under its number instead of its record — remove ${n === 1 ? 'it' : 'them'} in 3. BOM Engine first` }));
    (flows || []).forEach(flow => {
        if (!flow) return;
        const name = flowLabelOf(flow);
        const { steps, ...head } = flow;
        const scan = (node, where) => {
            refsIn(node, REF_KEYS).forEach(r => { if (wanted(r.value)) edges.push({ from: null, value: r.value, text: `CPQ flow "${name}"${where}` }); });
            // A flow step may be tied to one LINE of a bill of materials — that holds the assembly whose line it is.
            refsIn(node, ['linkedPinId']).forEach(r => {
                const owner = pinOwner.get(r.value);
                if (owner) edges.push({ from: null, value: U(owner.id), text: `CPQ flow "${name}"${where} uses one of its bill-of-materials lines` });
            });
        };
        scan(head, '');
        (Array.isArray(steps) ? steps : []).forEach((s, i) => scan(s, ` — ${stepLabelOf(s, i)}`));
    });
    all.forEach(item => {
        const self = U(item.id), label = itemLabelOf(item);
        refsIn(item, REF_KEYS).forEach(r => {
            if (!wanted(r.value) || r.value === self) return;
            const text = r.key === 'aliasOf' ? `alias ${label} points to it`
                : /kitComponents/.test(r.path) ? `kit ${label} lists it as a component`
                : `item ${label} names it (${r.path})`;
            edges.push({ from: item.id, value: r.value, text });
        });
        tagRefsOf(item).forEach(r => {
            if (!wanted(r.value)) return;
            edges.push({ from: item.id, value: r.value, numberOnly: true,
                text: r.key === 'materialTwin' ? `${label} names it as its ${r.detail || 'other-material'} twin` : `${label} names it as its ${r.detail} species item` });
        });
    });

    const going = new Set(targets.map(p => p.id));
    const held = new Map();     // id → Set(text)
    const hold = (p, text) => { if (!held.has(p.id)) held.set(p.id, new Set()); held.get(p.id).add(text); };
    const live = (e) => !(e.from && going.has(e.from));         // what names it is not going too
    const recordOf = (e) => (e.numberOnly ? null : targetById.get(e.value)) || null;
    // By RECORD ID — always holds.
    const heldByRecord = () => edges.filter(live).map(e => [recordOf(e), e.text]).filter(([p, ]) => p);
    // By NUMBER — holds only when no surviving record carries that number (or is that id).
    const heldByNumber = () => {
        const staying = new Set();
        all.forEach(p => { if (!going.has(p.id)) { staying.add(U(p.id)); numbersOf(p).forEach(n => staying.add(n)); } });
        const out = [];
        edges.filter(live).forEach(e => {
            if (recordOf(e) || staying.has(e.value)) return;
            (targetsByNumber.get(e.value) || []).forEach(p => out.push([p, `${e.text} — by number, and no other record would carry it`]));
        });
        return out;
    };
    // Held → no longer going → may hold others in turn, and may answer for a number: repeat until nothing changes.
    // Record-id holds settle first, so a duplicate may go when the record that stays answers for their number.
    const take = (found) => {
        const fresh = found.filter(([p, ]) => going.has(p.id));
        fresh.forEach(([p, text]) => hold(p, text));
        fresh.forEach(([p, ]) => going.delete(p.id));
        return fresh.length;
    };
    for (let guard = 0; guard <= targets.length; guard++) {
        while (take(heldByRecord())) { /* until settled */ }
        if (!take(heldByNumber())) break;
    }
    // Every record-id reason a held record has, including from records that were themselves held later.
    heldByRecord().forEach(([p, text]) => { if (!going.has(p.id)) hold(p, text); });

    const deletable = targets.filter(p => going.has(p.id));
    const refused = targets.filter(p => !going.has(p.id)).map(p => ({ part: p, uses: [...(held.get(p.id) || ['still in use'])] }));
    const lines = {};
    deletable.forEach(p => { if (ownLines.has(p.id)) lines[p.id] = ownLines.get(p.id); });
    const variantsLeft = [];
    deletable.forEach(p => {
        const n = itemNumberOf(p);
        if (!n || n.includes('/')) return;
        const variants = all.filter(x => !going.has(x.id) && itemNumberOf(x).startsWith(`${n}/`));
        if (variants.length) variantsLeft.push({ part: p, variants });
    });
    return { deletable, lines, refused, variantsLeft, missing };
}

/** How many bill-of-materials lines go with the plan's records. */
export const lineCountOf = (plan) => Object.values((plan && plan.lines) || {}).reduce((n, l) => n + l.length, 0);

/** The same answer both times? (the check is run again at the moment of the delete) — the records AND their lines. */
export const samePlan = (a, b) => {
    const sig = (plan) => [
        ((plan && plan.deletable) || []).map(p => p.id).sort().join('|'),
        Object.values((plan && plan.lines) || {}).flat().map(l => String(l.id)).sort().join('|'),
    ].join('#');
    return sig(a) === sig(b);
};

/** The copy the deletion ledger keeps — the record, with its item number where the ledger's index reads it. */
export const ledgerRecordOf = (part) => ({ ...part, itemCode: itemNumberOf(part) || String((part && part.id) || '') });

/**
 * What else in the database is keyed to the deleted records and would meet a re-imported one.
 *
 * @param parts            the records being deleted
 * @param diffIds          the ids present under system/ns_import_diffs/items
 * @param retiredIds       system/retired_items.internalIds, as stored (numbers or strings)
 * @param assets           every global_assets record ({ id, associatedParts })
 * @returns {
 *   diffIds:   [record id]                                   — NetSuite-differs records to delete
 *   retired:   { next: [...], removed: [...] } | null        — the locked list without these items (null: untouched)
 *   assets:    [{ id, associatedParts: [...] }]              — gallery pictures, with their link to these items taken off
 * }
 */
export function residualsOf({ parts, diffIds, retiredIds, assets }) {
    const ids = new Set((parts || []).map(p => String(p.id)));
    const internal = new Set((parts || []).map(p => String(p.netSuiteInternalId == null ? '' : p.netSuiteInternalId).trim()).filter(Boolean));
    const list = Array.isArray(retiredIds) ? retiredIds : [];
    const removed = list.filter(x => internal.has(String(x).trim()));
    return {
        diffIds: (diffIds || []).map(String).filter(id => ids.has(id)),
        retired: removed.length ? { next: list.filter(x => !internal.has(String(x).trim())), removed } : null,
        assets: (assets || []).filter(a => a && Array.isArray(a.associatedParts) && a.associatedParts.some(x => ids.has(String(x))))
            .map(a => ({ id: a.id, associatedParts: a.associatedParts.filter(x => !ids.has(String(x))) })),
    };
}

/**
 * The records in groups that each fit ONE Firestore batch — so a record's ledger copy, its delete and everything
 * keyed to it commit together or not at all. A batch holds 500 writes and about 10 MB: three writes a record (ledger,
 * delete, NetSuite-differs), one per bill-of-materials line plus their ledger entry, one per gallery picture it is
 * linked from, one for the locked list.
 */
export function deleteChunks(parts, assets, { lines = {}, maxOps = 400, maxBytes = 2000000 } = {}) {
    const linked = new Map();       // record id → gallery picture ids
    (assets || []).forEach(a => (Array.isArray(a && a.associatedParts) ? a.associatedParts : []).forEach(x => {
        const k = String(x); linked.set(k, [...(linked.get(k) || []), a.id]);
    }));
    const sizeOf = (v) => { try { return JSON.stringify(v).length; } catch (e) { return 0; } };
    const out = [];
    let cur = [], pics = new Set(), bytes = 0, ops = 1;
    (parts || []).forEach(p => {
        const own = (lines && lines[p.id]) || [];
        const mine = linked.get(String(p.id)) || [];
        const withMine = new Set([...pics, ...mine]);
        const cost = 3 + (own.length ? own.length + 1 : 0);
        const size = sizeOf(p) + (own.length ? sizeOf(own) : 0);
        if (cur.length && (ops + cost + withMine.size > maxOps || bytes + size > maxBytes)) {
            out.push(cur); cur = []; pics = new Set(mine); bytes = 0; ops = 1;
        } else pics = withMine;
        cur.push(p); bytes += size; ops += cost;
    });
    if (cur.length) out.push(cur);
    return out;
}

/**
 * Delete the records — each group of deleteChunks in ONE batch: every record's ledger copy, its delete, its own
 * bill-of-materials lines (with a ledger copy of them), its NetSuite-differs record, its gallery links and its entry
 * on the locked list commit together or not at all. An unrecorded delete cannot happen, and neither can a record
 * that is gone with something old still keyed to it.
 *
 * Stops at the first group that fails: what committed before it stays committed and is returned; that group and
 * everything after it is untouched.
 *
 * @param ctx    { db, doc, writeBatch, recordDeletion } — Firestore's own functions and Shared/orderLifecycle's
 *               recordDeletion (the ONE ledger writer; handed the batch as its setDoc, its entry rides the batch)
 * @param parts  the records to delete (planItemDelete(...).deletable)
 * @param lines  planItemDelete(...).lines
 * @param store  { diffIds, retiredIds, assets } as read from the database (see residualsOf)
 * @returns { deleted: [part], lines: how many bill-of-materials lines went, failed: '' | the error }
 */
export async function applyItemDelete(ctx, { parts, lines, store, by, reason, onProgress }) {
    const { db, doc, writeBatch, recordDeletion } = ctx;
    const list = Array.isArray(parts) ? parts : [];
    const own = lines || {};
    const diffIds = (store && store.diffIds) || [];
    let retiredIds = (store && store.retiredIds) || [];
    let assets = (store && store.assets) || [];
    const why = String(reason || '').trim();
    const deleted = [];
    let lineCount = 0;
    let chunks;
    try { chunks = deleteChunks(list, assets, { lines: own }); } catch (e) { return { deleted, lines: lineCount, failed: String((e && e.message) || e) }; }
    for (const chunk of chunks) {
        let r, chunkLines = 0;
        try {
            r = residualsOf({ parts: chunk, diffIds, retiredIds, assets });
            const batch = writeBatch(db);
            const ledger = { db, doc, setDoc: (ref, data) => batch.set(ref, data) };
            const stamp = { mode: 'HARD', by: by || '', from: 'LIBRARY_TRUE_DELETE' };
            for (const p of chunk) {
                const itemCode = ledgerRecordOf(p).itemCode;
                const said = [String(p.itemName || '').trim(), why].filter(Boolean).join(' · ');
                await recordDeletion(ledger, { ...stamp, collection: 'Approved_Designs', docId: p.id, record: ledgerRecordOf(p), kind: 'LIBRARY_ITEM', reason: said });
                batch.delete(doc(db, 'Approved_Designs', p.id));
                const mine = (own[p.id] || []).filter(l => l && l.id);
                if (mine.length) {
                    await recordDeletion(ledger, { ...stamp, collection: 'assembly_pins', docId: `${p.id} · ${plural(mine.length, 'line', 'lines')}`,
                        record: { itemCode, assemblyId: p.id, lines: mine }, kind: 'LIBRARY_BOM_LINES', reason: said });
                    mine.forEach(l => batch.delete(doc(db, 'assembly_pins', String(l.id))));
                    chunkLines += mine.length;
                }
            }
            r.diffIds.forEach(id => batch.delete(doc(db, 'system', 'ns_import_diffs', 'items', id)));
            r.assets.forEach(a => batch.update(doc(db, 'global_assets', a.id), { associatedParts: a.associatedParts }));
            if (r.retired) batch.update(doc(db, 'system', 'retired_items'), { internalIds: r.retired.next });
            await batch.commit();
        } catch (e) {
            return { deleted, lines: lineCount, failed: String((e && e.message) || e) };
        }
        deleted.push(...chunk);
        lineCount += chunkLines;
        // What the next group reads is what this one left.
        if (r.retired) retiredIds = r.retired.next;
        if (r.assets.length) {
            const next = new Map(r.assets.map(a => [a.id, a.associatedParts]));
            assets = assets.map(a => (next.has(a.id) ? { ...a, associatedParts: next.get(a.id) } : a));
        }
        if (onProgress) onProgress(deleted.length, list.length);
    }
    return { deleted, lines: lineCount, failed: '' };
}
