// COLLECTION READINESS — is this item actually LOADED, or merely present? (playbook 4.1,
// Stuart 2026-08-08, built ahead of the H1 mass load.)
//
// "Loaded" is eight separate facts spread across four systems, and a hole in any one of them
// surfaces WEEKS later as a wrong quote line, a dropped SO line, a blank spec sheet, or a size
// dropdown that silently offers a part that doesn't exist at that diameter. This module turns
// those facts into one row of verdicts per item, so holes show BEFORE an operator hits them.
//
// Pure and Firestore-free: the caller (CollectionReadinessBoard) gathers the documents; this
// module only judges them — which is what makes the judgments testable under node --test.
//
// Verdict shape: { key, state: 'OK'|'WARN'|'FAIL'|'NA', detail } — FAIL blocks the workflow the
// check guards; WARN is drift that works today; NA = the check doesn't apply to this item.

// Explicit .js extensions: this module runs under `node --test` as well as CRA, and node's ESM
// resolver requires them (all five are leaf modules with no imports of their own).
import { buildSizeIndex, sizeVariantOf, SIZE_FAMILIES } from './sizeMatrix.js';
import { fabricutCodeOf } from './priceLevels.js';
import { normalizeCategory } from './assemblyTags.js';
import { isAliasDoc } from './aliasIdentity.js';
import { findClientPriceRow } from './clientPricing.js';

const codeOf = (p) => String((p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p?.itemId) || '').trim().toUpperCase();
const skOf = (p) => p?.manufacturingSpecs?.customData?.sizeKey || null;

export const CHECKS = [
    { key: 'SIZEKEY', label: 'Size key' },
    { key: 'SIBLINGS', label: 'Size siblings' },
    { key: 'PRICE', label: 'Base price' },
    { key: 'NSID', label: 'NetSuite id' },
    { key: 'TYPE', label: 'Product type' },
    { key: 'FAB', label: 'Fabricut tier + code' },
    { key: 'ROW', label: 'Customer row' },
    { key: 'PINNED', label: 'Pinned on master' },
];

// ── Individual checks ───────────────────────────────────────────────────────────────────────────

// The stamped sizeKey is what makes an item visible to the size swap, the ≥5-pin spec gate, and
// partAllowedAtSize. A finish variant (code contains '/') NEVER carries one by design.
export function checkSizeKey(part, familyKey) {
    const code = codeOf(part);
    if (code.includes('/')) return { key: 'SIZEKEY', state: 'NA', detail: 'finish variant — keys off its base doc' };
    const sk = skOf(part);
    if (!sk || !sk.family) return { key: 'SIZEKEY', state: 'FAIL', detail: 'no sizeKey — invisible to size swap and the spec-cell gate (stamp via importer/🧬)' };
    if (familyKey && sk.family !== familyKey) return { key: 'SIZEKEY', state: 'WARN', detail: `sizeKey family ${sk.family}, expected ${familyKey}` };
    if (!sk.dia || !sk.style) return { key: 'SIZEKEY', state: 'FAIL', detail: `sizeKey incomplete (dia="${sk.dia || ''}", style="${sk.style || ''}")` };
    return { key: 'SIZEKEY', state: 'OK', detail: `${sk.family} ${sk.dia} ${sk.style}${sk.projLetter ? '-' + sk.projLetter : ''}` };
}

// Does the size swap actually LAND somewhere at every other diameter? A miss is silent in
// production: quotes and spec sheets fall back to the base item's code.
export function checkSiblings(part, familyKey, sizeIndex) {
    const sk = skOf(part);
    if (!sizeIndex) return { key: 'SIBLINGS', state: 'NA', detail: 'no size index supplied' };
    if (!sk || !sk.family || codeOf(part).includes('/')) return { key: 'SIBLINGS', state: 'NA', detail: '' };
    const fam = SIZE_FAMILIES[familyKey || sk.family];
    if (!fam) return { key: 'SIBLINGS', state: 'NA', detail: `unknown family ${sk.family}` };
    const missing = [];
    (fam.dia.options || []).forEach((d) => {
        if (d.value === sk.dia) return;
        const res = sizeVariantOf(part, { family: sk.family, dia: d.value, proj: sk.projLetter || fam.baseProj }, sizeIndex);
        if (res.missing) missing.push(d.value);
    });
    if (!missing.length) return { key: 'SIBLINGS', state: 'OK', detail: 'resolves at every diameter' };
    return { key: 'SIBLINGS', state: 'WARN', detail: `no sibling at dia ${missing.join(', ')} — swap falls back to this item's own code there` };
}

export function checkPrice(part) {
    const v = parseFloat(part?.manufacturingSpecs?.basePrice);
    if (Number.isFinite(v) && v > 0) return { key: 'PRICE', state: 'OK', detail: `$${v}` };
    if (part?.isFee || part?.partClass === 'Fee' || String(part?.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE') {
        return { key: 'PRICE', state: Number.isFinite(v) ? 'OK' : 'WARN', detail: Number.isFinite(v) ? `fee $${v}` : 'fee with no price — priced by its flow step?' };
    }
    return { key: 'PRICE', state: 'WARN', detail: 'no basePrice — quotes fall to $0 unless a client row/level covers it' };
}

// Aliases are the one item KIND that must NOT be NetSuite-mapped (the sync excludes them; a mapped
// alias would push as itself instead of its real item). Everything else without an id is silently
// DROPPED from every pushed SO.
export function checkNsId(part) {
    const has = !!part?.netSuiteInternalId;
    if (isAliasDoc(part)) {
        return has
            ? { key: 'NSID', state: 'FAIL', detail: 'ALIAS with a NetSuite id — it would push as itself; remove the mapping' }
            : { key: 'NSID', state: 'OK', detail: 'alias — correctly unmapped' };
    }
    return has
        ? { key: 'NSID', state: 'OK', detail: String(part.netSuiteInternalId) }
        : { key: 'NSID', state: 'FAIL', detail: 'no NetSuite id — the line is dropped from every pushed SO' };
}

// The spec generator classifies scene-derived choices by the LIBRARY's productType — an
// unclassifiable type means the part cannot appear on a sheet built from a spec GLB.
export function checkType(part) {
    const raw = part?.manufacturingSpecs?.productType || part?.productType || '';
    const cat = normalizeCategory(raw);
    if (['BRACKET', 'BACKPLATE', 'FINIAL', 'RING', 'POLE'].includes(cat)) return { key: 'TYPE', state: 'OK', detail: cat };
    return { key: 'TYPE', state: 'WARN', detail: raw ? `"${raw}" → ${cat || 'OTHER'} — invisible to spec-GLB choice derivation` : 'no productType' };
}

// Fabricut levels: no tier data = FAB_* quotes silently fall to standard; no pattern # = the
// quote line and the FAB-edition sheet print the CE code.
export function checkFab(part, findByCode) {
    const base = codeOf(part).split('/')[0];
    const doc = codeOf(part).includes('/') && typeof findByCode === 'function' ? (findByCode(base) || part) : part;
    const fab = doc?.manufacturingSpecs?.fabricut;
    if (!fab) return { key: 'FAB', state: 'WARN', detail: 'no fabricut{} — FAB price levels fall to standard, no pattern #' };
    const hasTier = ['cost', 'wholesale', 'retail', 'paintedCost', 'paintedWholesale', 'paintedRetail', 'platedCost', 'platedWholesale', 'platedRetail']
        .some((f) => fab[f] !== undefined);
    const code = fabricutCodeOf(part, findByCode);
    if (hasTier && code) return { key: 'FAB', state: 'OK', detail: code };
    if (!hasTier) return { key: 'FAB', state: 'WARN', detail: 'fabricut{} without tier prices' };
    return { key: 'FAB', state: 'WARN', detail: 'tiers without a pattern # — lines print the CE code' };
}

// The customer's row — and HOW it is keyed. A name-keyed row works (every matcher now honours it)
// but is one CRM rename away from breaking; the CRM doc id is the durable key.
export function checkRow(part, custKeys, crmId) {
    if (!custKeys || !custKeys.size) return { key: 'ROW', state: 'NA', detail: 'no customer selected' };
    const row = findClientPriceRow(part?.clientPricing, custKeys);
    if (!row) return { key: 'ROW', state: 'WARN', detail: 'no row for this customer — prices at base/level only, no client SKU' };
    const idKeyed = String(row.customerId || '').trim() === String(crmId || '').trim();
    const px = parseFloat(row.price);
    const priced = Number.isFinite(px) && px > 0;
    if (idKeyed && priced) return { key: 'ROW', state: 'OK', detail: `${row.clientSku || 'no SKU'} · $${px}` };
    if (!idKeyed) return { key: 'ROW', state: 'WARN', detail: `row keyed by "${row.customerId}" not the CRM id — re-key it (a rename breaks it)` };
    return { key: 'ROW', state: 'WARN', detail: `${row.clientSku || 'no SKU'} · price ${row.price === undefined ? 'missing' : row.price} (≤0 = falls back to base)` };
}

// Reachability: an item no master assembly pins is invisible to CPQ flows and spec choice pins.
// Variants ride their base doc's pin; sub-diameter siblings are reached through the size swap,
// so only the FAMILY BASE diameter items are expected to be pinned directly.
export function checkPinned(part, pinnedIdSet, familyKey) {
    if (!pinnedIdSet || !pinnedIdSet.size) return { key: 'PINNED', state: 'NA', detail: 'no master pins loaded' };
    const code = codeOf(part);
    if (code.includes('/')) return { key: 'PINNED', state: 'NA', detail: 'variant — rides its base doc' };
    const hit = pinnedIdSet.has(part.id) || pinnedIdSet.has(code) || pinnedIdSet.has(String(part.itemId || '').toUpperCase());
    if (hit) return { key: 'PINNED', state: 'OK', detail: '' };
    const fam = SIZE_FAMILIES[familyKey];
    const sk = skOf(part);
    if (fam && sk && sk.dia !== fam.baseDia) return { key: 'PINNED', state: 'NA', detail: `dia ${sk.dia} — reached via size swap from the ${fam.baseDia} pin` };
    return { key: 'PINNED', state: 'WARN', detail: 'not pinned on any selected master — unreachable from flows/spec choices' };
}

// ── The one call per item ───────────────────────────────────────────────────────────────────────
export function scoreItem(part, ctx = {}) {
    const { familyKey, sizeIndex, findByCode, custKeys, crmId, pinnedIdSet } = ctx;
    const checks = [
        checkSizeKey(part, familyKey),
        checkSiblings(part, familyKey, sizeIndex),
        checkPrice(part),
        checkNsId(part),
        checkType(part),
        checkFab(part, findByCode),
        checkRow(part, custKeys, crmId),
        checkPinned(part, pinnedIdSet, familyKey),
    ];
    const fails = checks.filter((c) => c.state === 'FAIL').length;
    const warns = checks.filter((c) => c.state === 'WARN').length;
    return { code: codeOf(part), name: part?.itemName || '', checks, fails, warns, ready: fails === 0 && warns === 0 };
}

// Everything the board needs, in one pass. `parts` = the family's item docs (caller filters).
export function scoreCollection(parts, ctx = {}) {
    const allParts = ctx.allParts || parts;
    const sizeIndex = ctx.sizeIndex || buildSizeIndex(allParts);
    const byCode = new Map();
    allParts.forEach((p) => { [p.legacyErpId, p.itemId].forEach((c) => { const k = String(c || '').trim().toUpperCase(); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, p); }); });
    const findByCode = (c) => byCode.get(String(c || '').toUpperCase()) || null;
    const rows = parts.map((p) => scoreItem(p, { ...ctx, sizeIndex, findByCode }));
    const totals = {};
    CHECKS.forEach(({ key }) => {
        totals[key] = { ok: 0, warn: 0, fail: 0, na: 0 };
        rows.forEach((r) => { const c = r.checks.find((x) => x.key === key); totals[key][c.state.toLowerCase()] += 1; });
    });
    return { rows, totals, ready: rows.filter((r) => r.ready).length, total: rows.length };
}

// ── Spec-cell coverage (mirrors the 📐 modal's chip logic) ─────────────────────────────────────
export function cellCoverage(familyKey, sizeSources, projAllowed = () => true) {
    const fam = SIZE_FAMILIES[familyKey];
    if (!fam) return [];
    const out = [];
    (fam.dia.options || []).forEach((d) => {
        (fam.proj.options || []).filter((p) => projAllowed(familyKey, p, d.value)).forEach((p) => {
            const key = `${d.value}|${p.value}`;
            const entry = sizeSources?.[familyKey]?.[key];
            const kind = (entry?.glbUrl && !entry.assemblyId) ? 'GLB' : entry?.assemblyId ? 'ASSEMBLY' : 'MISSING';
            out.push({ key, dia: d.value, proj: p.value, kind, name: entry?.name || '', savedAt: entry?.savedAt || null });
        });
    });
    return out;
}
