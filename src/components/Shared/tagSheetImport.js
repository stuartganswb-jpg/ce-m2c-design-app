// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE TAGGING SHEET → THE PINS (Stuart 2026-08-18)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "i think we need to make a final control file like this that she can use going forward and then
//  we auto upload as this screen is very important and one simple mistake costs me hours in work
//  figuring out what happened."
//
// The designer already holds the truth: she knows which node is which part, which rod it dresses,
// what depth it is cut for. What she has never had is a way to hand that over without a person
// re-typing it into 150 dropdowns — and re-typing is where the hours go, because a wrong tag does
// not announce itself. It renders something plausible and wrong, three screens away.
//
// So the sheet becomes the input. This module reads it and returns a PATCH PER NODE; nothing here
// touches Firestore, and nothing here decides anything. The geometry still arrives as .fbx per
// slot exactly as before — the sheet only says what the pieces ARE.
//
// TWO RULES THAT KEEP IT HONEST:
//
//   THE NODE NAME IS THE ONLY JOIN. Not the row order, not the item number, not the slot name —
//     those all drift when a file is re-exported or a part is renamed. A node either exists in the
//     loaded geometry or it does not, and the import says which, by name, before anything is
//     written. A sheet row that matches nothing is reported, never guessed at.
//
//   IT NEVER INVENTS A CHOICE. If the sheet names a node that the .fbx does not contain, that is a
//     mismatch to fix at source, not a pin to conjure. The reverse — geometry with no row — is
//     reported too, because an untagged node renders in no configuration and is the exact failure
//     this whole exercise exists to prevent.
//
// The column vocabulary is the one on the KEY sheet of the template, and it is deliberately the
// same words the 1.6 controls use, so a person reading the sheet and a person reading the screen
// are reading the same thing.

import { tagsFromPhrase } from './tagPhrase.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const S = (v) => String(v == null ? '' : v).trim();
// ⚠ A FLAG IS TRI-STATE, AND BLANK MEANS "LEAVE IT ALONE" (Stuart 2026-08-18: "other than these
// new double tags, don't touch em with the upload"). Reading a blank cell as FALSE is the obvious
// implementation and it is wrong in the one way that matters: a sheet that says nothing about BASIC
// would have UNTICKED basic on every part it touched. A person filling a partial sheet is saying
// "here is what I know", never "everything I left out is false" — so only an explicit word decides.
const flag = (v) => {
    const u = U(v);
    if (!u) return undefined;                                   // untouched
    if (['Y', 'YES', 'TRUE', 'X', '1'].includes(u)) return true;
    if (['N', 'NO', 'FALSE', '0', '-'].includes(u)) return false;
    return undefined;                                           // anything else is not an answer
};

/** Header text → the field it fills. Tolerant of case, spacing and the (.fbx) suffix. */
const COLUMN = {
    'SLOT': 'slot', 'SLOT FILE': 'file', 'SLOT FILE (.FBX)': 'file',
    'CAT': 'cat', 'CATEGORY': 'cat',
    'POSITION': 'position', 'NODE NAME': 'node', 'NODE': 'node',
    'ITEM ID': 'item', 'ITEM': 'item', 'ITEM #': 'item',
    'ROD': 'tier', 'TIER': 'tier',
    'PROJ': 'proj', 'PROJECTION': 'proj',
    'SETUP': 'setup', 'TRV': 'trv', 'TRAVERSE': 'trv',
    'MOUNT': 'mount', 'MADE IN': 'materials', 'MATERIAL': 'materials', 'MATERIALS': 'materials',
    'BASIC': 'basic', 'INL-BKT': 'inline', 'INLINE': 'inline', 'INL': 'inline',
    'FEE': 'fee', 'HIDE': 'hide', 'ALWAYS': 'always', 'COLLAR': 'collar',
    'REQUIRES COLLAR': 'requiresCollar', 'END TREATMENT': 'endTreatment',
    'NOTES': 'note', 'NOTE': 'note',
    'TAG': 'tag', 'TAG — WHAT IS IT?': 'tag', 'TAG - WHAT IS IT?': 'tag',
};

/** A node name as it is compared: whitespace and case are noise, everything else is not. */
// ⚠ THE NAME SHE WROTE DOWN IS NOT THE NAME THE MODEL STORES (Stuart 2026-08-18, 415 of 464 rows
// matching nothing). Fusion exports a component as "H1-138BR v2:3" — a version and an instance
// number — and the importer has always cleaned both off, because the version is a modelling detail
// and the instance is one of several copies of the same part. The designer reads names off her
// Fusion browser, so her sheet says "H1-138BR:3". Neither is wrong; it is the same part, spelled at
// two different moments. So the comparison cleans exactly the way Shared/fusionImport does, on both
// sides, before it compares anything.
//
// Instances then collapse — H1-138BR:1 and :3 are both H1-138BR — which is correct, because they
// ARE one part. The SLOT is what tells two copies apart, and where it cannot, the row is reported
// rather than guessed at.
const cleanFusion = (s) => S(s)
    .replace(/[\s_]v\d+.*$/i, '')      // " v2:3", and anything after it
    .replace(/:\d+$/, '')              // a bare instance number
    .replace(/\.\d{3}$/, '')           // Blender's ".001"
    .replace(/_+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A node name as it is compared: version, instance, case and spacing are all noise. */
export const nodeKey = (n) => cleanFusion(n).toUpperCase();

// ── THE NAME IN THE FILE IS NOT THE NAME ON THE PIN (Stuart 2026-08-18) ──────────────────────
// Merge renames every node to `<slot-prefix>__<n>_<original, stripped of punctuation, 24 chars>`,
// because GLB exporters reuse generic names across files and the engine matches geometry BY NAME —
// without a per-slot namespace two clusters cannot be told apart. Excellent, and it means a sheet
// written against the .fbx matches NOTHING once the assembly is merged and saved. The original is
// still in there, at the tail, in sanitized form — so that is what we compare.
const sanitize = (n) => cleanFusion(n).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const MERGE_TAIL = 24;                                    // the merge's own truncation
// Fusion also writes a copy number with a SPACE — "… DBL Back left 1" — which the colon rule does
// not catch. Stripping every trailing digit is too blunt to do everywhere (H1-138B6 and H1-1D6 END
// in a digit that is part of the code), so it is a LAST RESORT, used only inside a slot and only
// when exactly one row there answers to it. Two rows in one slot that differ only by a trailing
// number stay ambiguous and are refused, which is the right answer for "Arm 4" beside "Arm 6".
export const nodeTail = (n) => {
    const raw = S(n);
    // a merged name: <prefix>__<index>_<sanitized original>
    const m = raw.match(/__\d+_(.*)$/);
    return sanitize(m ? m[1] : raw).slice(0, MERGE_TAIL);
};
export const looseTail = (n) => nodeTail(n).replace(/\d+$/, '');

/** Cluster and slot names compared the way merge writes them: LABEL → LABEL-WITH-DASHES. */
export const slotKey = (n) => S(n).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');

// ── THE TWO RETURN FEES FILL THEMSELVES IN (Stuart 2026-08-18) ───────────────────────────────
// "these two fees cover the french and miter return cuts in a lot of collections, it should fill
//  these in when it sees them as default, i can manually overwrite for the rare occurrences."
//
// So a row that says "FR 6 LEFT" gets the french fee's number without anyone typing it. The CODES
// are deliberately not written down here: the caller passes a lookup that finds the library's fee
// item BY ITS feeType, so a collection that one day prices its returns differently is a new fee
// item and not a new release. Her own Item ID always wins — this only fills a blank, or replaces a
// number that is plainly not a fee (the rod's, which is what she had been writing).
export function fillReturnFees(patches, findFeeItem) {
    if (typeof findFeeItem !== 'function') return patches;
    patches.forEach(p => {
        if (!p.__feeType) return;
        const code = findFeeItem(p.__feeType);
        if (!code) return;
        const has = S(p.itemNo);
        const looksLikeAFee = /FEE/i.test(has);
        if (!has || !looksLikeAFee) p.itemNo = code;
    });
    return patches;
}

/**
 * Read a sheet already loaded as rows of cells.
 *
 * @param rows  [[cell, …], …] — row 1 is the header
 * @returns { patches: Map<nodeKey, patch>, slots: [{slot,file,cat,position,nodes:[]}], warnings }
 */
export function parseTagRows(rows = []) {
    const warnings = [];
    const header = (rows[0] || []).map(h => U(h).replace(/\s+/g, ' '));
    const idx = {};
    header.forEach((h, i) => { const f = COLUMN[h]; if (f && idx[f] === undefined) idx[f] = i; });
    if (idx.node === undefined) {
        return { patches: new Map(), slots: [], warnings: ['No NODE NAME column — this is not a tagging sheet.'] };
    }
    const get = (row, f) => (idx[f] === undefined ? '' : S(row[idx[f]]));

    const patches = new Map();
    const slots = new Map();
    rows.slice(1).forEach((row, i) => {
        const node = get(row, 'node');
        if (!node) return;
        // ⚠ A NODE NAME IS ONLY UNIQUE WITHIN ITS SLOT (Stuart 2026-08-18, from the real file). The
        // H1-138 double reuses 17 names from the singles — both files call a plate H1-138TRVBP-V:1,
        // because they ARE both that plate, in two different assemblies' geometry. Keying rows by
        // node name alone threw the second one away and reported it as a duplicate; the single's
        // row vanished and its part would have taken the DOUBLE's tags. The slot is what tells
        // them apart, and merge namespaces by slot for exactly the same reason.
        const key = `${slotKey(get(row, 'slot'))}::${nodeKey(node)}`;
        if (patches.has(key)) { warnings.push(`Row ${i + 2}: node "${node}" appears twice in the same slot — the first wins.`); return; }

        // Everything the 1.6 choice carries, in the 1.6 spelling. Blank means "leave it alone" for
        // free-text fields and "off" for the flags, which is what a blank cell means to a person.
        const p = {
            itemNo: get(row, 'item'),
            catOverride: U(get(row, 'cat')) === 'CARRIER' ? '' : U(get(row, 'cat')),
            tier: U(get(row, 'tier')),
            projInches: U(get(row, 'proj')),
            trvSetup: U(get(row, 'setup')),
            traverseRole: U(get(row, 'trv')) || (U(get(row, 'cat')) === 'CARRIER' ? 'CARRIER' : ''),
            mountType: U(get(row, 'mount')),
            materials: U(get(row, 'materials')).replace(/\s*\(NO FINISH\)\s*/i, ''),
            requiresCollar: get(row, 'requiresCollar'),
            note: get(row, 'note'),
            ...(get(row, 'endTreatment') ? { endTreatment: U(get(row, 'endTreatment')) } : {}),
        };
        // Only the flags the sheet actually answers are carried; the rest are simply absent, so
        // apply has nothing to write and the tick on screen survives untouched.
        [['basic', 'isBasic'], ['inline', 'inlineOnly'], ['fee', 'isFee'], ['hide', 'isHidden'],
         ['always', 'alwaysShown'], ['collar', 'isCollar']].forEach(([col, field]) => {
            const f = flag(get(row, col));
            if (f !== undefined) p[field] = f;
        });
        // CLEAR is a material that takes no finish — the flag the renderer reads, set here so the
        // sheet says it once rather than the tagger remembering to tick two things.
        if (U(get(row, 'materials')).startsWith('CLEAR')) p.noFinish = true;
        // POSITION belongs to the slot, not the choice, but it is carried so the import can tell a
        // person when the sheet disagrees with the cluster it landed in.
        p.__position = U(get(row, 'position'));
        p.__slot = get(row, 'slot');
        p.__file = get(row, 'file');
        p.__node = node;
        // From the TAG phrase, when the sheet did not spell the tags out itself.
        const phrase = tagsFromPhrase(get(row, 'tag') || get(row, 'slot'));
        if (phrase.feeType) p.__feeType = phrase.feeType;
        if (phrase.fee && p.isFee === undefined) p.isFee = true;
        patches.set(key, p);

        const sk = p.__slot || p.__file || '(unnamed)';
        if (!slots.has(sk)) slots.set(sk, { slot: p.__slot, file: p.__file, cat: U(get(row, 'cat')), position: p.__position, nodes: [] });
        slots.get(sk).nodes.push(node);
    });
    return { patches, slots: [...slots.values()], warnings };
}

/**
 * Match a sheet against the choices actually loaded in 1.6, and say exactly what would happen.
 * Nothing is applied here — a person reads this first.
 *
 * @param rows2d   the sheet
 * @param loaded   [{ clusterId, clusterName, choices:[{nodeName,…}] }]
 */
export function planTagImport(rows2d, loaded = [], { findFeeItem, knownCode } = {}) {
    const { patches, warnings } = parseTagRows(rows2d);
    fillReturnFees(patches, findFeeItem);   // a return's fee number is looked up, never typed

    // ── AN ITEM NUMBER THAT IS NOT AN ITEM IS NOT AN ITEM NUMBER (Stuart 2026-08-18) ─────────
    // "it populated with items that do not even exist, nearly the fusion code."
    //
    // He is right, and the damage would have been quiet: a pin whose partId is `8-32, 3/8"
    // L_91253A192` — a SCREW, which has no item number and never should — looks like a part all the
    // way down the line. It prices at nothing, it bills as nothing, and it sits in a BOM as a line
    // nobody can order. The sheet offered it because a blank Item ID cell had been filled in from
    // the NODE name, and shared hardware is exactly the case that must stay blank.
    //
    // So the library is the authority: a number it does not know is not written, and is listed. A
    // sheet cannot invent a part here however badly it is filled in — blank is always available and
    // always safe, because blank hardware simply creates no pin.
    const unknownItems = [];
    if (typeof knownCode === 'function') {
        patches.forEach(p => {
            const code = S(p.itemNo);
            if (!code || knownCode(code)) return;
            unknownItems.push(`${p.__node || '?'} → ${code}`);
            delete p.itemNo;
        });
    }

    // ── FINDING THE RIGHT ROW FOR A PIN, IN THREE TRIES ─────────────────────────────────────
    // 1. the exact node name, for a slot that has not been merged yet;
    // 2. the SLOT plus the sanitized tail, for anything already merged — this is the one that
    //    matters, because the H1-138 double reuses 17 node names from the singles (both files call
    //    a plate H1-138TRVBP-V:1) and the tail alone cannot tell those two plates apart;
    // 3. the tail alone, ONLY when exactly one row in the whole sheet carries it.
    // A tail that several rows claim, with no slot to separate them, is reported and left alone —
    // guessing there would put the double's tags on a single's part, which is the one outcome this
    // import must never produce.
    const byExact = new Map();
    const byScoped = new Map();
    const byTail = new Map();
    const byLoose = new Map();
    patches.forEach((p) => {
        const nk = nodeKey(p.__node), t = nodeTail(p.__node);
        if (!byExact.has(nk)) byExact.set(nk, []);
        byExact.get(nk).push(p);
        if (p.__slot) {
            byScoped.set(`${slotKey(p.__slot)}::${t}`, p);
            const lk = `${slotKey(p.__slot)}::${looseTail(p.__node)}`;
            byLoose.set(lk, byLoose.has(lk) ? null : p);   // null = two rows here, so neither wins
        }
        if (!byTail.has(t)) byTail.set(t, []);
        byTail.get(t).push(p);
    });
    const ambiguous = new Set();
    const seen = new Set();
    const hits = [];
    loaded.forEach(r => (r.choices || []).forEach(ch => {
        const k = nodeKey(ch.nodeName);
        const t = nodeTail(ch.nodeName);
        // The slot wins whenever it can, because it is the only thing that separates two parts
        // that share a name.
        let p = byScoped.get(`${slotKey(r.clusterName || '')}::${t}`);
        // Same slot, same name but for a trailing copy number Fusion added.
        if (!p) p = byLoose.get(`${slotKey(r.clusterName || '')}::${looseTail(ch.nodeName)}`) || null;
        if (!p) {
            const ex = byExact.get(k) || [];
            if (ex.length === 1) p = ex[0];
            else if (ex.length > 1) { ambiguous.add(`${ch.nodeName} — ${ex.length} rows claim it (${ex.map(c => c.__slot || '?').join(', ')})`); return; }
        }
        if (!p) {
            const cands = byTail.get(t) || [];
            if (cands.length > 1) { ambiguous.add(`${ch.nodeName} — ${cands.length} rows claim it (${cands.map(c => c.__slot || '?').join(', ')})`); return; }
            // ⚠ THE LAST RESORT NEEDS A SECOND OPINION (Stuart 2026-08-18, the wood ring). Matching
            // on the name alone, with no slot to confirm it, put a POLE row's tags on a RING: the
            // rings slot holds a node called H1-138WR and so does the wood rod, and only one row in
            // the sheet claimed that name, so it looked unambiguous. It was not — it was the wrong
            // part with the right name. When nothing but the name agrees, the CATEGORY must agree
            // too, or the row is left alone and said out loud.
            if (cands.length === 1) {
                const rowCat = U(cands[0].catOverride);
                const pinCat = U(ch.catOverride || r.category || '');
                // ⚠ NO CATEGORY MEANS NO NAME-ONLY MATCH (Stuart 2026-08-18, the wood ring, twice).
                // A row that states its category can be checked against the part it landed on, and
                // a POLE row is refused on a RING. A row that states NONE cannot be checked at all
                // — and the rows with none are exactly the singles, stripped bare on purpose so an
                // upload could not touch them. Letting those match on a bare name is the one way
                // left for a rod's tag to reach a ring that happens to share its name.
                //
                // Nothing is lost by refusing: the singles' two tags are set by category, by
                // "Finish the singles", which cannot mistake a ring for a rod because it never
                // looks at a name.
                if (!rowCat) { ambiguous.add(`${ch.nodeName} — the only row with that name states no category, so it cannot be checked`); return; }
                if (pinCat && rowCat !== pinCat) {
                    ambiguous.add(`${ch.nodeName} — the only row with that name is a ${rowCat}, this is a ${pinCat}`);
                    return;
                }
                p = cands[0];
            }
        }
        if (!p) return;
        seen.add(`${slotKey(p.__slot)}::${nodeKey(p.__node)}`);
        // What actually CHANGES — a sheet that agrees with the screen should read as no work.
        const diff = [];
        Object.entries(p).forEach(([f, v]) => {
            if (f.startsWith('__')) return;
            const was = ch[f];
            const now = typeof v === 'boolean' ? v : S(v);
            const before = typeof v === 'boolean' ? !!was : S(was);
            if (now === '' && typeof v !== 'boolean') return;      // blank never clears free text
            if (now !== before) diff.push({ field: f, from: before, to: now });
        });
        hits.push({ clusterId: r.clusterId, clusterName: r.clusterName, nodeName: ch.nodeName, patch: p, diff });
    }));
    const matchedNodes = new Set(hits.map(h => nodeKey(h.nodeName)));
    const unmatchedRows = [...patches.values()].filter(p => !seen.has(`${slotKey(p.__slot)}::${nodeKey(p.__node)}`)).map(p => p.__node);
    const untagged = [];
    loaded.forEach(r => (r.choices || []).forEach(ch => {
        if (!matchedNodes.has(nodeKey(ch.nodeName)) && S(ch.nodeName)) untagged.push({ cluster: r.clusterName, node: ch.nodeName });
    }));
    return {
        hits,
        changed: hits.filter(h => h.diff.length),
        unmatchedRows,
        untagged,
        ambiguous: [...ambiguous],
        unknownItems,
        warnings,
    };
}

/** Apply a plan to the 1.6 rows, returning new rows. Pure — the caller decides to keep them. */
export function applyTagPlan(loaded, plan) {
    const by = new Map(plan.hits.map(h => [`${h.clusterId}::${nodeKey(h.nodeName)}`, h.patch]));   // the plan already resolved which row won
    return loaded.map(r => ({
        ...r,
        choices: (r.choices || []).map(ch => {
            const p = by.get(`${r.clusterId}::${nodeKey(ch.nodeName)}`);
            if (!p) return ch;
            const next = { ...ch };
            Object.entries(p).forEach(([f, v]) => {
                if (f.startsWith('__')) return;
                if (typeof v === 'boolean') { next[f] = v; return; }
                if (S(v) !== '') next[f] = v;                       // blank leaves what is there
            });
            return next;
        }),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SHEET DEFINES THE SLOTS (Stuart 2026-08-18)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "why do we need to load the files in the slots? with the new sheet, can't we build an import tool
//  similar to 14.5 and 14.6, as the details for each slot are in the sheet"
//
// He is right, and the file proves it. 1.6 has always offered a FIXED slot list — ten for a double
// bracket — while the designer's double is 37 files: a bracket set per family, plates per family,
// finials per rod per end. The fixed list has no backplate slots for a double at all. So today the
// only way through is for her to merge many files into few, by hand, which is work she should not
// be doing and a place for a mistake that costs an afternoon.
//
// The sheet already carries the slot, its file, its category and its position on every row. That IS
// the slot list. Reading it means she exports whatever grouping her model actually has, and the
// screen takes the shape of her work rather than the other way round.
//
// Category is mapped, not invented: an END TREATMENT lives in the FINIAL category with its own
// endTreatment tag (that is how a return and a finial share one question), and a CARRIER is a RING
// whose traverse role makes it a rider. Everything else passes through.

const SLOT_CATEGORY = { POLE: 'POLE', BRACKET: 'BRACKET', BACKPLATE: 'BACKPLATE', FINIAL: 'FINIAL',
    RING: 'RING', RETURN: 'FINIAL', CARRIER: 'RING' };

const slugOf = (s) => S(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'slot';

/**
 * The slot list this sheet describes, in the shape 1.6's uploader already uses.
 *
 * @returns { slots:[{id,label,category,position,location,desc,file}], warnings }
 */
export function slotsFromSheet(rows2d = []) {
    const { patches, warnings } = parseTagRows(rows2d);
    const bySlot = new Map();
    patches.forEach((p) => {
        const name = p.__slot || p.__file;
        if (!name) return;
        // ⚠ THE FILE IS PART OF A SLOT'S IDENTITY, not just its name. The designer names several
        // slots "steel rod" — one per .fbx — because the name describes the PART and the file is
        // what says which piece of it. Keying on the name alone silently merged five slots into one
        // and would have loaded one file over the top of the last four.
        const id = slugOf(`${name}__${p.__file || ''}`);
        if (!bySlot.has(id)) bySlot.set(id, { id, label: name, file: p.__file, cats: new Set(), positions: new Set(), mounts: new Set(), nodes: [] });
        const sl = bySlot.get(id);
        sl.nodes.push(p.__node);
        if (p.catOverride) sl.cats.add(p.catOverride);
        else if (p.traverseRole === 'CARRIER') sl.cats.add('CARRIER');   // only when nothing said otherwise
        if (p.__position) sl.positions.add(p.__position);
        if (p.mountType) sl.mounts.add(p.mountType);
    });
    const slots = [...bySlot.values()].map(sl => {
        const cat = [...sl.cats][0] || '';
        if (sl.cats.size > 1) warnings.push(`Slot "${sl.label}" mixes categories (${[...sl.cats].join(', ')}) — using ${cat}.`);
        return {
            id: sl.id,
            label: sl.label,
            category: SLOT_CATEGORY[cat] || cat || 'POLE',
            position: [...sl.positions][0] || 'SHARED',
            location: [...sl.mounts][0] || '',
            file: sl.file,
            desc: `From the tagging sheet · ${sl.nodes.length} choice(s)${sl.file ? ` · ${sl.file}` : ''}`,
        };
    });
    const noFile = slots.filter(s => !s.file).map(s => s.label);
    if (noFile.length) warnings.push(`${noFile.length} slot(s) name no .fbx: ${noFile.slice(0, 4).join(', ')}${noFile.length > 4 ? '…' : ''}`);
    return { slots, warnings };
}

/** Match the sheet's slot files against the files a person actually chose. Name only, case-insensitive. */
export function matchSlotFiles(slots, files = []) {
    const by = new Map();
    files.forEach(f => by.set(String(f.name || '').trim().toLowerCase(), f));
    const paired = [], missing = [];
    slots.forEach(s => {
        const f = s.file ? by.get(String(s.file).trim().toLowerCase()) : null;
        if (f) paired.push({ slot: s, file: f }); else if (s.file) missing.push(s);
    });
    const used = new Set(paired.map(p => String(p.file.name).toLowerCase()));
    const extra = files.filter(f => !used.has(String(f.name).toLowerCase())).map(f => f.name);
    return { paired, missing, extra };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// FINISHING THE SINGLES WITHOUT NAMING A SINGLE NODE (Stuart 2026-08-18)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The singles cannot be tagged from the sheet, and the reason is not fixable by trying harder: the
// built model names their three copies "H1-138BS LEFT / CENTER / RIGHT" while her sheet, written
// from Fusion, calls them "H1-138BS:1 / :2 / :3". Once the instance number is cleaned off — and it
// must be, or nothing matches at all — the three collapse into one name inside one slot. Matching
// harder would only mean guessing which of three brackets a row meant, which is the failure this
// import exists to avoid.
//
// But their two tags never needed a node name. They are facts about a CATEGORY:
//
//   a BRACKET or BACKPLATE that is not part of the double is a SINGLE one;
//   a POLE that is not the back rod is the FRONT rod.
//
// So it fills BLANKS ONLY. Anything the sheet already set — every DOUBLE, every BACK — is left
// exactly as it is, which makes this safe to run twice and impossible to run backwards. It is not a
// rule the engine consults; it is a one-time edit to the same fields a person would have typed.

const CAT_OF = (choice, cluster) => U(choice.catOverride || cluster.category || '');

/** What "finish the singles" would change, without changing anything. */
export function planSinglesFill(loaded = []) {
    const hits = [];
    loaded.forEach(r => (r.choices || []).forEach(ch => {
        const cat = CAT_OF(ch, r);
        // ⚠ A BLANK IS NOT AN ANSWER (Stuart 2026-08-18, catching this before it ran). "The pole has
        // no tier, so it is the front one" only holds for a pole that is not part of a double at
        // all. Every REAR pole was also blank — because the tier tag was being dropped on save —
        // and this would have stamped FRONT across all of them, which is the precise opposite of
        // the truth and the hardest kind of wrong to see afterwards.
        //
        // A pole that says SETUP = DOUBLE belongs to the double. Its tier is either already set or
        // not yet decided, and neither is this rule's business. That flag has always been saved, so
        // it is something known rather than something assumed.
        const isDoublePart = U(ch.trvSetup) === 'DOUBLE';
        const diff = [];
        if (['BRACKET', 'BACKPLATE'].includes(cat) && !S(ch.trvSetup)) diff.push({ field: 'trvSetup', to: 'SINGLE' });
        if (cat === 'POLE' && !S(ch.tier) && !isDoublePart) diff.push({ field: 'tier', to: 'FRONT' });
        if (diff.length) hits.push({ clusterId: r.clusterId, clusterName: r.clusterName, nodeName: ch.nodeName, diff });
    }));
    return {
        hits,
        brackets: hits.filter(h => h.diff.some(d => d.field === 'trvSetup')).length,
        poles: hits.filter(h => h.diff.some(d => d.field === 'tier')).length,
    };
}

/** Apply it. Blanks only — never a value that is already there. */
export function applySinglesFill(loaded, plan) {
    const by = new Set(plan.hits.map(h => `${h.clusterId}::${nodeKey(h.nodeName)}`));
    return loaded.map(r => ({
        ...r,
        choices: (r.choices || []).map(ch => {
            if (!by.has(`${r.clusterId}::${nodeKey(ch.nodeName)}`)) return ch;
            const cat = CAT_OF(ch, r);
            const next = { ...ch };
            if (['BRACKET', 'BACKPLATE'].includes(cat) && !S(next.trvSetup)) next.trvSetup = 'SINGLE';
            if (cat === 'POLE' && !S(next.tier)) next.tier = 'FRONT';
            return next;
        }),
    }));
}
