// FABRICUT ASSET TAGS (tabs 14 Asset Gallery / 14.5 Batch Processor) — derives searchable identity
// for gallery assets from the LIVE Master Library, so uploads resolve the way the CPQ flows do.
// The core object is the TWO-PART COMBO: a plate (backplate = standard, included in the arm price;
// coverplate = paid upgrade) photographed WITH the fee item (french/miter return) or bracket arm
// that uses it. buildComboMeta() turns that pair + a finish into a `fab{}` struct and flat `tags[]`
// stamped on the global_assets doc — additive fields, existing docs keep working.
// Identity logic is IMPORTED (sizeKey metadata stamped by Shared/fabricutImport, vocabulary from
// Shared/assemblyTags) — never re-implemented here.
import { PROJECTION_BY_LETTER } from './fabricutImport';
import { normalizeCategory, endTreatmentOf, suggestTagsFromName } from './assemblyTags';

const U = (s) => String(s == null ? '' : s).trim().toUpperCase();

export const DIA_LABELS = {
    '75': '3/4"', '1': '1"', '138': '1-3/8"',
    '75S': '3/4" SQUARE', '2RCT': '2" RECTANGULAR', '1B': '1" BRASS',
    '138TRV': '1-3/8" TRAVERSE', '2TRV': '2" TRAVERSE',
};
export const PROJ_LABELS = { S: '3-5/8"', E: '4-5/8"', '6': '6"', D: 'DOUBLE' };
export const PLATE_ORIENTATIONS = { H: 'HORIZONTAL', R: 'ROUND', S: 'SQUARE', V: 'VERTICAL' };
export const END_TREATMENT_LABELS = { FRENCH_RETURN: 'FRENCH RETURN', MITER_RETURN: 'MITER RETURN', INSIDE_MOUNT: 'INSIDE MOUNT', FINIAL: 'FINIAL' };
const SPECIES_LABELS = { '-O': 'WHITE OAK', '-W': 'WALNUT' };

// O(1) code lookup over Approved_Designs. Keys: legacyErpId, itemId, doc id — all uppercased.
export function buildPartIndex(hqParts) {
    const byCode = new Map();
    const list = Array.isArray(hqParts) ? hqParts : [];
    list.forEach(p => {
        [p.legacyErpId, p.itemId, p.id].forEach(k => {
            const c = U(k);
            if (c && c !== 'PENDING' && !byCode.has(c)) byCode.set(c, p);
        });
    });
    return { byCode, list };
}

export const findPartByCode = (code, partIndex) => partIndex?.byCode?.get(U(code)) || null;

export const partCodeOf = (p) => U(p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p?.itemId || p?.id));

// Resolve a typed pattern id to its base library doc: strip /P //EPn finish suffix, tolerate the
// -O/-W species suffix, and reverse the stem-different speciesMap (H1-138WHTOAK → H1-138WR base).
export function resolveBaseDoc(patternId, partIndex) {
    const raw = U(patternId);
    if (!raw) return { doc: null, base: '', finishSuffix: '', species: '' };
    const [base, finishSuffix = ''] = raw.split('/');
    let doc = findPartByCode(base, partIndex);
    let species = '';
    if (!doc) {
        const m = base.match(/^(.*)(-O|-W)$/);
        if (m) { doc = findPartByCode(m[1], partIndex); if (doc) species = m[2]; }
    }
    if (!doc && partIndex?.list) {
        doc = partIndex.list.find(p => {
            const sm = p?.manufacturingSpecs?.customData?.speciesMap;
            return sm && Object.values(sm).some(v => U(v) === base);
        }) || null;
        if (doc) {
            const sm = doc.manufacturingSpecs.customData.speciesMap;
            species = Object.keys(sm).find(k => U(sm[k]) === base) || '';
        }
    }
    return { doc, base, finishSuffix, species };
}

// Plate identity: sizeKey style first (stamped by the importer: "BP-R", "RCP-S", …), code-shape
// fallback for plates the library hasn't matched. kind ∈ BP|CP|RBP|RCP.
export function plateInfoOf(code, doc) {
    const sk = doc?.manufacturingSpecs?.customData?.sizeKey;
    let dia = sk?.dia || '', style = sk?.style || '';
    if (!style) {
        const m = U(code).match(/^H1-(.+?)(R?[BC]P)-([A-Z])$/);
        if (!m) return null;
        dia = m[1]; style = `${m[2]}-${m[3]}`;
    }
    const sm = style.match(/^(R?)([BC]P)-?([A-Z]?)$/);
    if (!sm) return null;
    const kind = `${sm[1]}${sm[2]}`;
    return {
        dia, kind,
        isCover: sm[2] === 'CP',
        isReturn: sm[1] === 'R',
        orientation: PLATE_ORIENTATIONS[sm[3]] || U(doc?.manufacturingSpecs?.customData?.bpOrientation) || '',
    };
}

// Canonical finish id from a render-filename token: EP zero-pad strips (EP01→EP1, matching library
// variants), P/S pad to two digits (master_finishes P01–P30 / S01–S12). Trailing words = Fabricut's
// color name ("EP01-stain nickel" → EP1 + STAIN NICKEL).
export function normalizeFinishToken(token) {
    const m = U(token).match(/^(EP|P|S)\s*0*(\d+)(?:[\s-]+(.*))?$/);
    if (!m) return { finishId: U(token).replace(/[^A-Z0-9-]/g, ''), colorName: '' };
    const n = parseInt(m[2], 10);
    const finishId = m[1] === 'EP' ? `EP${n}` : `${m[1]}${String(n).padStart(2, '0')}`;
    return { finishId, colorName: (m[3] || '').trim() ? U(m[3]).trim() : '' };
}

// Kermit Labs render grammar: "<subject>_<FabricutCode>_<finish token [color name]>_<camera>.png"
// e.g. "french return_HNFSRFRSB079_EP01-stain nickel_main.png". Null when the name doesn't fit.
export function parseRenderFilename(fileName) {
    const stem = String(fileName || '').replace(/\.[^.]+$/, '');
    const parts = stem.split('_');
    if (parts.length < 3) return null;
    const camera = parts.length >= 4 ? U(parts[parts.length - 1]) : '';
    const finishToken = parts.length >= 4 ? parts.slice(2, parts.length - 1).join('_') : parts[2];
    const { finishId, colorName } = normalizeFinishToken(finishToken);
    if (!finishId) return null;
    return {
        subject: U(parts[0]),
        fabCode: U(parts[1]).replace(/[^A-Z0-9-]/g, ''),
        finishId,
        fabColorName: colorName,
        camera,
    };
}

// Tier-aware Fabricut code for OUR finish id (mirrors priceLevels' tier rules): an exact xlsx
// suffix wins, EP* finishes take the premium (plated) code, other finishes the painted code,
// no finish the base code. Render filenames are NOT a trusted code source — this is.
export function fabricutCodeForFinish(doc, finishId) {
    const fab = doc?.manufacturingSpecs?.fabricut;
    if (!fab) return '';
    const f = U(finishId);
    const exact = fab[`exact_${f}`]?.fabCode;
    if (exact) return U(exact);
    if (f.startsWith('EP')) return U(fab.fabCodePremium || fab.fabCodePainted || fab.fabCodeBase || '');
    if (f) return U(fab.fabCodePainted || fab.fabCodeBase || fab.fabCodePremium || '');
    return U(fab.fabCodeBase || fab.fabCodePainted || fab.fabCodePremium || '');
}

// Every Fabricut catalog code the CrossReference import stamped on a base doc.
export function fabricutCodesOfDoc(doc) {
    const fab = doc?.manufacturingSpecs?.fabricut;
    if (!fab) return [];
    const out = new Set();
    ['fabCodeBase', 'fabCodePainted', 'fabCodePremium'].forEach(k => { if (fab[k]) out.add(U(fab[k])); });
    Object.keys(fab).forEach(k => { if (k.startsWith('exact_') && fab[k]?.fabCode) out.add(U(fab[k].fabCode)); });
    return [...out];
}

// FABRICUT'S OWN color name for a finish — the clientMapping row tab 4.5's Master Finish editor
// stores for the CRM customer "Fabricut" ({ customerId, clientFinishName }). AUTHORITATIVE over
// render filenames (those carry typos); returns '' until the names are loaded in 4.5.
export function fabricutColorNameOf(finishId, finishLists) {
    const c = U(finishId).replace(/^EP0+(\d+)$/, 'EP$1');
    if (!c) return '';
    for (const list of finishLists || []) {
        for (const f of (Array.isArray(list) ? list : [])) {
            if (U(f?.code) !== c && U(f?.id) !== c) continue;
            const hit = (Array.isArray(f?.clientMapping) ? f.clientMapping : []).find(m => U(m?.customerId).includes('FABRICUT'));
            if (hit?.clientFinishName) return U(hit.clientFinishName);
        }
    }
    return '';
}

// Our color name for a finish id, scanned across whatever finish lists the caller has loaded
// (master_finishes doc's finishes[], hq_global/outsource/inhouse collections).
export function ourFinishNameOf(finishId, finishLists) {
    const c = U(finishId);
    if (!c) return '';
    for (const list of finishLists || []) {
        for (const f of (Array.isArray(list) ? list : [])) {
            if (U(f?.code) === c || U(f?.id) === c) return U(f?.name || '');
        }
    }
    return '';
}

// The second half of the combo: the fee item (french/miter return — replaces the arm in CPQ) or
// the real bracket arm / inside-mount the plate is photographed with.
export function pairedInfoOf(doc) {
    if (!doc) return null;
    const et = endTreatmentOf({ part: doc });
    const isFee = et === 'FRENCH_RETURN' || et === 'MITER_RETURN';
    const sk = doc?.manufacturingSpecs?.customData?.sizeKey || null;
    const cat = normalizeCategory(doc?.manufacturingSpecs?.productType) || suggestTagsFromName(doc?.itemName).category || '';
    return {
        docId: doc.id,
        code: partCodeOf(doc),
        name: U(doc.itemName || ''),
        role: isFee ? 'FEE' : 'ARM',
        endTreatment: isFee || et === 'INSIDE_MOUNT' ? et : '',
        category: cat || 'BRACKET',
        dia: sk?.dia || '', projLetter: sk?.projLetter || '', family: sk?.family || '',
    };
}

const pushTag = (arr, ...vals) => vals.forEach(v => { const t = U(v); if (t && !arr.includes(t)) arr.push(t); });

// THE TWO-PART COMBO: plate code (folder name / patternId) + paired fee-or-arm doc + finish.
// Returns { fab, tags, name, associatedParts } ready to spread onto a global_assets doc — or a
// plate-only result when pairedDoc is null (still tagged, just no combo half).
export function buildComboMeta({ plateCode, pairedDoc, finishId, fabCode, fabColorName, partIndex, finishLists }) {
    const plateDoc = findPartByCode(plateCode, partIndex);
    const plate = plateInfoOf(plateCode, plateDoc);
    const paired = pairedInfoOf(pairedDoc);
    if (!plate && !paired) return null;

    const fin = U(finishId);
    const ourFinishName = ourFinishNameOf(fin, finishLists);
    // 4.5's Fabricut clientMapping name beats whatever the (typo-prone) filename said
    const authColorName = fabricutColorNameOf(fin, finishLists) || U(fabColorName) || '';
    const dia = plate?.dia || paired?.dia || '';
    const projLetter = paired?.projLetter || '';
    const fabCodes = [...new Set([...fabricutCodesOfDoc(plateDoc), ...fabricutCodesOfDoc(pairedDoc)])];
    // The singular fabCode: the caller's (CrossReference-fed form / folder-sticky) wins; when
    // none was passed — the bulk re-tag backfilling pre-alignment imports — derive it from the
    // docs' own CrossReference codes, paired doc first (the batch conveyor's exact precedence).
    const oneFabCode = U(fabCode) || fabricutCodeForFinish(pairedDoc, fin) || fabricutCodeForFinish(plateDoc, fin) || '';
    if (oneFabCode) fabCodes.unshift(oneFabCode);

    const fab = {
        source: 'ASSET_TAGGER',
        family: plateDoc?.manufacturingSpecs?.customData?.sizeKey?.family || paired?.family || '',
        dia, diaLabel: DIA_LABELS[dia] || '',
        projLetter, projLabel: PROJ_LABELS[projLetter] || '',
        plateCode: plate ? U(plateCode) : '', plateKind: plate?.kind || '',
        plateOrientation: plate?.orientation || '', plateIsCover: plate ? plate.isCover : null,
        plateIsReturn: plate ? plate.isReturn : null, plateDocId: plateDoc?.id || '',
        // THE PLATE RULE: arm price includes the standard backplate ($0 by design); coverplate is
        // the flat-price upgrade. plateIncluded tells the gallery which badge to show.
        plateIncluded: plate ? !plate.isCover : null,
        pairedCode: paired?.code || '', pairedName: paired?.name || '',
        pairedRole: paired?.role || '', pairedDocId: paired?.docId || '',
        endTreatment: paired?.endTreatment || '',
        finishId: fin, ourFinishName, fabColorName: authColorName,
        fabCode: oneFabCode, fabCodes: [...new Set(fabCodes)],
    };

    const tags = [];
    if (paired) {
        pushTag(tags, END_TREATMENT_LABELS[paired.endTreatment], paired.name, paired.code);
        if (paired.role === 'ARM') pushTag(tags, 'BRACKET ARM', 'BRACKET');
        if (paired.role === 'FEE') pushTag(tags, 'FEE');
    }
    if (plate) {
        pushTag(tags, U(plateCode), plate.orientation);
        if (plate.isCover) pushTag(tags, 'COVERPLATE', 'COVER PLATE', 'UPGRADE');
        else pushTag(tags, 'BACKPLATE', 'BACK PLATE', 'INCLUDED');
        if (plate.isReturn) pushTag(tags, 'RETURN PLATE');
    }
    pushTag(tags, fab.diaLabel, fab.projLabel, PROJECTION_BY_LETTER[projLetter]);
    pushTag(tags, fin, ourFinishName, fab.fabColorName);
    fab.fabCodes.forEach(c => pushTag(tags, c));

    const comboLabel = paired ? (END_TREATMENT_LABELS[paired.endTreatment] || paired.code) : '';
    const plateLabel = plate ? `${U(plateCode)}${fin ? `/${fin}` : ''}` : fin;
    const name = comboLabel && plateLabel ? `${comboLabel} + ${plateLabel}` : (plateLabel || comboLabel);

    return {
        fab, tags, name,
        associatedParts: [plateDoc?.id, paired?.docId].filter(Boolean),
    };
}

// Single-item fallback (no combo): any resolvable Fabricut/H1 pattern id still gets fab{} + tags[]
// (size labels, role, species, siblings via the sizeKey chain, Fabricut codes, finish names).
export function buildSingleMeta({ patternId, finishId, partIndex, finishLists }) {
    const { doc, base, species } = resolveBaseDoc(patternId, partIndex);
    if (!doc) return null;
    const plate = plateInfoOf(base, doc);
    if (plate) return buildComboMeta({ plateCode: base, pairedDoc: null, finishId, partIndex, finishLists });

    const sk = doc?.manufacturingSpecs?.customData?.sizeKey || null;
    const fin = U(finishId);
    const ourFinishName = ourFinishNameOf(fin, finishLists);
    const et = endTreatmentOf({ part: doc });
    const cat = normalizeCategory(doc?.manufacturingSpecs?.productType) || suggestTagsFromName(doc?.itemName).category || '';
    // BASIC brackets take NO backplate/coverplate (the 1.6 isBasic rule — that flag lives on
    // assembly PINS the gallery never loads, so the item name is the available signal here;
    // Fabricut's line literally names them "Basic Bracket").
    const isBasic = cat === 'BRACKET' && /\bBASIC\b/.test(U(doc?.itemName || ''));
    // size siblings: the base-pattern photo serves every diameter/projection of the same style
    const siblings = sk ? partIndex.list.filter(p => {
        const s = p?.manufacturingSpecs?.customData?.sizeKey;
        return s && s.family === sk.family && s.style === sk.style && p !== doc;
    }).map(partCodeOf) : [];

    const fab = {
        source: 'ASSET_TAGGER',
        family: sk?.family || '', dia: sk?.dia || '', diaLabel: DIA_LABELS[sk?.dia] || '',
        projLetter: sk?.projLetter || '', projLabel: PROJ_LABELS[sk?.projLetter] || '',
        role: cat, endTreatment: et || '',
        species: species || '', speciesLabel: SPECIES_LABELS[species] || '',
        // an arm's product image IS arm + standard backplate; CP is the upgrade — EXCEPT basic
        // brackets, which take no plate at all
        includesBackplate: cat === 'BRACKET' ? !isBasic : null,
        isBasic: cat === 'BRACKET' ? isBasic : null,
        finishId: fin, ourFinishName, fabColorName: fabricutColorNameOf(fin, finishLists),
        // derived from the doc's own CrossReference codes (finish tier aware) — backfills
        // pre-alignment imports on re-tag instead of leaving the singular code empty
        fabCode: fabricutCodeForFinish(doc, fin),
        fabCodes: fabricutCodesOfDoc(doc), siblingCodes: siblings,
    };
    const tags = [];
    pushTag(tags, partCodeOf(doc), doc.itemName, cat, END_TREATMENT_LABELS[et]);
    if (cat === 'BRACKET') { if (isBasic) pushTag(tags, 'BRACKET ARM', 'BASIC', 'NO BACKPLATE'); else pushTag(tags, 'BRACKET ARM', 'INCLUDES BACKPLATE'); }
    pushTag(tags, fab.diaLabel, fab.projLabel, PROJECTION_BY_LETTER[sk?.projLetter], fab.speciesLabel);
    pushTag(tags, fin, ourFinishName, fab.fabColorName);
    fab.fabCodes.forEach(c => pushTag(tags, c));
    siblings.forEach(c => pushTag(tags, c));

    return { fab, tags, name: '', associatedParts: [doc.id] };
}

// Default paired-item candidates for a plate: same-family return fees / brackets / inside mounts
// at the plate's diameter. Suggestions only — the human picks (assemblyTags rule: name regexes and
// derived pairings never act as runtime truth).
export function pairedCandidatesFor(plateCode, partIndex, queryText) {
    const q = U(queryText);
    const list = partIndex?.list || [];
    const plateDoc = findPartByCode(plateCode, partIndex);
    const plate = plateInfoOf(plateCode, plateDoc);
    const diaOf = (p) => p?.manufacturingSpecs?.customData?.sizeKey?.dia || '';
    if (q) {
        // "H1-DE" should find H1-1DE / H1-138DE etc. — also match with the H1- prefix stripped,
        // and float the plate's diameter to the top when the folder pins the size.
        const qAlt = q.replace(/^H1-?/, '');
        const hits = list.filter(p => {
            const code = partCodeOf(p);
            if (code.includes('/')) return false;
            return code.includes(q) || U(p.itemName).includes(q) || (qAlt.length >= 2 && code.includes(qAlt));
        });
        if (plate?.dia) hits.sort((a, b) => (diaOf(b) === plate.dia ? 1 : 0) - (diaOf(a) === plate.dia ? 1 : 0));
        return hits.slice(0, 25);
    }
    if (!plate) return [];
    return list.filter(p => {
        if (partCodeOf(p).includes('/')) return false;
        const info = pairedInfoOf(p);
        if (!info) return false;
        if (info.dia && plate.dia && info.dia !== plate.dia) return false;
        return info.role === 'FEE' || info.endTreatment === 'INSIDE_MOUNT' || info.category === 'BRACKET';
    }).slice(0, 25);
}

// One lowercase searchable blob per asset — the gallery AND-matches query tokens against it.
export function assetSearchBlob(asset, partIndex, finishLists) {
    const bits = [
        asset?.name, asset?.patternId, asset?.finishId, asset?.customerId,
        asset?.clientSku, asset?.customerPartId, asset?.collection, asset?.category,
        asset?.productType, asset?.notes, asset?.fabCode,
        ...(Array.isArray(asset?.tags) ? asset.tags : []),
    ];
    if (asset?.fab) bits.push(JSON.stringify(asset.fab));
    const fin = ourFinishNameOf(asset?.finishId, finishLists);
    if (fin) bits.push(fin);
    const fabName = fabricutColorNameOf(asset?.finishId, finishLists);
    if (fabName) bits.push(fabName);
    (Array.isArray(asset?.associatedParts) ? asset.associatedParts : []).forEach(pid => {
        const p = findPartByCode(pid, partIndex) || partIndex?.list?.find(x => x.id === pid);
        if (p) bits.push(partCodeOf(p), p.itemName, JSON.stringify(p.manufacturingSpecs?.fabricut || ''));
        else bits.push(pid);
    });
    return bits.filter(Boolean).join(' ').toLowerCase();
}
