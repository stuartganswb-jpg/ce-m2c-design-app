// PORTAL PRICING ENGINE (server-side) — a CommonJS port of the internal CPQ pricing engine
// (src/components/HQ/CPQTab.js pricing memo + Shared/sizeMatrix.js + Shared/priceLevels.js). Runs in
// the portalResolve Cloud Function with the SAME data CPQTab loads (flow + Approved_Designs parts +
// assembly_pins BOM + finishes + the customer's clientPricing), so the portal shows prices identical
// to HQ without shipping any parts/cost data to the client. Keep in sync with the three source files.

// ============================ sizeMatrix (ported) ============================
const SIZE_STEP_TYPE = 'SIZE_SELECT';
const SIZE_FAMILIES = {
  'H1-RND': {
    label: 'Fabricut H1 Round', baseDia: '75', baseProj: 'E',
    dia: { id: 'SIZE-DIA', title: 'Rod Diameter', options: [
      { optId: 'SIZE-DIA-75', value: '75', label: '3/4" Round Rod', scale: 1, inches: 0.75 },
      { optId: 'SIZE-DIA-1', value: '1', label: '1" Round Rod', scale: 1.25, inches: 1 },
      { optId: 'SIZE-DIA-138', value: '138', label: '1-3/8" Round Rod', scale: 1.5, inches: 1.375 },
    ] },
    proj: { id: 'SIZE-PROJ', title: 'Bracket Projection', options: [
      { optId: 'SIZE-PROJ-S', value: 'S', label: '3-5/8" Projection' },
      { optId: 'SIZE-PROJ-E', value: 'E', label: '4-5/8" Projection' },
      { optId: 'SIZE-PROJ-6', value: '6', label: '6" Projection' },
    ] },
    returnsMinProj: ['E', '6'],
  },
};
const skOf = (p) => (p && p.manufacturingSpecs && p.manufacturingSpecs.customData && p.manufacturingSpecs.customData.sizeKey) || null;

function sizeSelectionsOf(flow, config) {
  const steps = ((flow && flow.steps) || []).filter((s) => s && s.type === SIZE_STEP_TYPE);
  if (!steps.length) return null;
  const familyKey = steps[0].sizeFamily || 'H1-RND';
  const fam = SIZE_FAMILIES[familyKey];
  if (!fam) return null;
  const pick = (axis, axisDef, dflt) => {
    const st = steps.find((s) => s.sizeAxis === axis);
    const sel = st ? (config || {})[st.id] : null;
    const opt = sel ? axisDef.options.find((o) => o.optId === sel) : null;
    return opt || axisDef.options.find((o) => o.value === dflt) || axisDef.options[0];
  };
  const d = pick('DIA', fam.dia, fam.baseDia);
  const p = pick('PROJ', fam.proj, fam.baseProj);
  return { family: familyKey, dia: d.value, proj: p.value, scale: d.scale || 1, diaInches: d.inches, isBase: d.value === fam.baseDia && p.value === fam.baseProj };
}
function returnsAllowedFor(sel) {
  if (!sel) return true;
  const fam = SIZE_FAMILIES[sel.family];
  if (!fam || !fam.returnsMinProj) return true;
  return fam.returnsMinProj.includes(sel.proj);
}
function isReturnOption(o) {
  const t = String((o && o.endTreatment) || '').toUpperCase();
  if (t === 'FRENCH_RETURN' || t === 'MITER_RETURN') return true;
  return /^OPT-(BEND|MITER)/i.test(String((o && o.optId) || ''));
}
function buildSizeIndex(parts) {
  const idx = new Map();
  (parts || []).forEach((p) => {
    const sk = skOf(p);
    if (!sk || !sk.family) return;
    const code = String(p.legacyErpId || p.itemId || '');
    if (code.includes('/')) return;
    const key = `${sk.family}|${sk.dia}|${sk.style}|${sk.projLetter || ''}`;
    if (!idx.has(key)) idx.set(key, p);
  });
  return idx;
}
function sizeVariantOf(part, sel, sizeIndex) {
  const sk = skOf(part);
  if (!part || !sel || !sk || sk.family !== sel.family) return { part, swapped: false };
  const targetDia = sel.dia || sk.dia;
  const targetProj = !sk.projLetter ? '' : sk.projLetter === 'D' ? 'D' : (sel.proj || sk.projLetter);
  let targetStyle = sk.style;
  if (targetDia !== '75' && /^R[BC]P-/.test(targetStyle)) targetStyle = targetStyle.slice(1);
  if (targetDia === sk.dia && targetProj === (sk.projLetter || '') && targetStyle === sk.style) return { part, swapped: false };
  const hit = sizeIndex.get(`${sel.family}|${targetDia}|${targetStyle}|${targetProj}`);
  if (!hit || hit === part) return { part, swapped: false, missing: `${sel.family} ${targetDia} ${targetStyle}${targetProj ? '-' + targetProj : ''}` };
  return { part: hit, swapped: true };
}
function speciesVariantOf(part, finishObj, findByCode) {
  let sfx = String((finishObj && finishObj.bomSuffix) || '').trim().toUpperCase();
  if (sfx === 'OAK' || sfx === 'O' || sfx === '-O') sfx = '-O';
  else if (sfx === 'WALNUT' || sfx === 'WAL' || sfx === 'W' || sfx === '-W') sfx = '-W';
  else if (sfx && !sfx.startsWith('-')) sfx = `-${sfx}`;
  if (!part || !sfx || typeof findByCode !== 'function') return part;
  const baseCode = String((part.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part.itemId) || '').trim().toUpperCase();
  if (!baseCode || baseCode.includes('/')) return part;
  const mapped = part.manufacturingSpecs && part.manufacturingSpecs.customData && part.manufacturingSpecs.customData.speciesMap && part.manufacturingSpecs.customData.speciesMap[sfx];
  const hit = (mapped && findByCode(String(mapped).trim().toUpperCase())) || findByCode(`${baseCode}${sfx}`);
  return hit || part;
}
function partAllowedAtSize(part, sel, sizeIndex) {
  const sk = part && part.manufacturingSpecs && part.manufacturingSpecs.customData && part.manufacturingSpecs.customData.sizeKey;
  if (!part || !sel || !sk || sk.family !== sel.family) return true;
  const fam = SIZE_FAMILIES[sel.family];
  if (!fam || sk.dia === sel.dia || sk.dia === fam.baseDia) return true;
  return !sizeVariantOf(part, sel, sizeIndex).missing;
}
function makeSizeSwap(flow, config, parts) {
  const sel = sizeSelectionsOf(flow, config);
  let idx = null;
  const swap = (part) => {
    if (!sel || !part || !skOf(part)) return part;
    if (!idx) idx = buildSizeIndex(parts);
    return sizeVariantOf(part, sel, idx).part || part;
  };
  return { sel, swap, scale: (sel && sel.scale) || 1, returnsAllowed: returnsAllowedFor(sel) };
}

// ============================ priceLevels (ported) ============================
const PRICE_LEVELS = [
  { id: 'STANDARD', short: 'STANDARD' },
  { id: 'FAB_COST', short: 'FABRICUT COST', field: 'cost' },
  { id: 'FAB_WHOLESALE', short: 'FABRICUT WHOLESALE', field: 'wholesale' },
  { id: 'FAB_RETAIL', short: 'FABRICUT RETAIL', field: 'retail' },
];
function fabricutCodeOf(part, findByCode) {
  if (!part) return null;
  const code = String(part.legacyErpId || part.itemId || '').trim().toUpperCase();
  if (!code) return null;
  const [base, sfx = ''] = code.split('/');
  let doc = part;
  if ((sfx || !(part.manufacturingSpecs && part.manufacturingSpecs.fabricut)) && typeof findByCode === 'function') doc = findByCode(base) || part;
  const fab = doc && doc.manufacturingSpecs && doc.manufacturingSpecs.fabricut;
  if (!fab) return null;
  if (sfx.startsWith('EP')) return fab.fabCodePremium || fab.fabCodePainted || fab.fabCodeBase || null;
  return fab.fabCodePainted || fab.fabCodeBase || fab.fabCodePremium || null;
}
function fabricutPriceOf(part, levelId, finishCode) {
  const lvl = PRICE_LEVELS.find((l) => l.id === levelId);
  const fab = part && part.manufacturingSpecs && part.manufacturingSpecs.fabricut;
  if (!lvl || !lvl.field || !fab) return null;
  const code = String((part.legacyErpId || part.itemId) || '').trim().toUpperCase();
  const suffix = code.includes('/') ? code.split('/')[1] : '';
  const fcU = String(finishCode || '').toUpperCase();
  const tier = (suffix.startsWith('EP') || (!suffix && fcU.startsWith('EP'))) ? 'plated' : 'painted';
  const tiered = (f) => (fab[f] !== undefined ? fab[f] : fab[`${tier}${f[0].toUpperCase()}${f.slice(1)}`]);
  let v = tiered(lvl.field);
  if (lvl.field === 'wholesale' && (v === undefined || v === null)) {
    const r = tiered('retail');
    if (r !== undefined && r !== null && Number.isFinite(parseFloat(r))) return parseFloat(r) / 2;
    v = r;
  }
  if (v === undefined) return null;
  if (v === null) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ============================ pricing memo (ported) ============================
// ctx: { flow, assembly, params, quantities, allParts, finishes, outsourceFinishes, bomPins,
//        custKeys (Set of UPPER customer id/name), priceLevel }
function computePricing(ctx) {
  const { flow, assembly, params, quantities, allParts, finishes, outsourceFinishes, bomPins, custKeys, priceLevel } = ctx;
  const breakdown = [];
  if (!flow) return { lines: [], total: 0 };

  let baseAssemblyPrice = (assembly && assembly.manufacturingSpecs && assembly.manufacturingSpecs.basePrice) ? parseFloat(assembly.manufacturingSpecs.basePrice) : 0;
  if (!assembly && flow.basePrice) baseAssemblyPrice = parseFloat(flow.basePrice);
  if (baseAssemblyPrice > 0) {
    breakdown.push({ name: assembly ? assembly.itemName : flow.name, qty: 1, price: baseAssemblyPrice, total: baseAssemblyPrice });
  }
  let total = baseAssemblyPrice;

  const byCode = new Map();
  allParts.forEach((p) => { [p.legacyErpId, p.itemId].forEach((c) => { const k = String(c || '').trim().toUpperCase(); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, p); }); });
  const findByCode = (c) => byCode.get(c) || null;

  const finishVariantOf = (basePart, finishCode) => {
    if (!basePart || !finishCode) return basePart;
    const baseCode = String((basePart.legacyErpId && basePart.legacyErpId !== 'PENDING' ? basePart.legacyErpId : basePart.itemId) || '').trim().toUpperCase();
    if (!baseCode || baseCode.includes('/')) return basePart;
    const fc = String(finishCode).trim().toUpperCase();
    const cands = [`${baseCode}/${fc}`];
    if (/^P\d/.test(fc)) cands.push(`${baseCode}/P`);
    if (/^EP\d/.test(fc)) cands.push(`${baseCode}/EP`);
    for (const cand of cands) { const hit = byCode.get(cand); if (hit) return hit; }
    return basePart;
  };
  const finishObjForStep = (stepId) => {
    const fid = params[`${stepId}__finish`];
    if (!fid) return null;
    return finishes.find((x) => x.id === fid) || outsourceFinishes.find((x) => x.id === fid) || null;
  };
  const finishCodeForStep = (stepId) => { const f = finishObjForStep(stepId); return f ? String(f.code || f.name || '').toUpperCase() : ''; };
  const speciesSwap = (part, finishObj) => speciesVariantOf(part, finishObj, findByCode);
  const isFeePart = (p, opt) => !!((opt && opt.isFee) || (p && p.partClass === 'Fee') || String((p && p.manufacturingSpecs && p.manufacturingSpecs.productType) || '').toUpperCase() === 'FEE');
  const lineNameFor = (p, opt) => {
    const desc = (p && (p.itemName || p.name)) || (opt && opt.partName) || '';
    if (isFeePart(p, opt)) return desc;
    if (priceLevel === 'FAB_WHOLESALE' || priceLevel === 'FAB_RETAIL') return fabricutCodeOf(p, findByCode) || desc;
    return desc;
  };
  const sizeBundle = makeSizeSwap(flow, params, allParts);
  const findLibPart = (key) => {
    if (!key) return null;
    const exact = allParts.find((p) => p.id === key || p.itemId === key || p.legacyErpId === key);
    if (exact) return exact;
    const nk = String(key).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (nk.length < 3) return null;
    let best = null, bestLen = 0;
    allParts.forEach((p) => [p.legacyErpId, p.itemId].forEach((code) => {
      const nc = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (nc.length >= 3 && nk.startsWith(nc) && nc.length > bestLen) { best = p; bestLen = nc.length; }
    }));
    return best;
  };
  const clientPriceFor = (part) => {
    if (!custKeys || !custKeys.size || !part || !Array.isArray(part.clientPricing)) return null;
    const cp = part.clientPricing.find((c) => custKeys.has(String((c.customerId) || '').trim().toUpperCase()));
    const v = cp ? parseFloat(cp.price) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  (flow.steps || []).forEach((step) => {
    const selectedValue = params[step.id];
    if (step.type === SIZE_STEP_TYPE) {
      const sizeOpt = (step.styleOptions || []).find((o) => o.optId === selectedValue);
      if (sizeOpt) breakdown.push({ name: `${step.title}: ${sizeOpt.partName || sizeOpt.label}`, qty: 1, price: 0, total: 0 });
      return;
    }
    let rawQty = quantities[step.id];
    let qty = 1;
    if (rawQty !== undefined && rawQty !== '') qty = parseInt(rawQty) || 0;
    else qty = (bomPins.find((p) => p.partId === step.linkedPinId) || {}).defaultQty || 1;
    if (step.hideQty && qty === 0 && selectedValue) qty = (bomPins.find((p) => p.partId === step.linkedPinId) || {}).defaultQty || 1;

    const hasBasePrice = step.basePrice !== undefined && step.basePrice !== null && step.basePrice !== '';
    if (selectedValue || step.type === 'STATIC_FEE' || hasBasePrice) {
      let stepPrice = hasBasePrice ? parseFloat(step.basePrice) : 0;
      if (step.linkedItemId && step.useClientPricing) { const v = clientPriceFor(findLibPart(step.linkedItemId)); if (v != null) stepPrice = v; }
      let multiplier = 1.0;
      let itemName = step.title;
      let lineIsFee = step.type === 'STATIC_FEE';
      let resolvedPartId = selectedValue;
      let resolvedErpId = null;

      if (selectedValue) {
        const styleOpt = step.type === 'STYLE_SWAP' ? (step.styleOptions || []).find((o) => (o.optId || o.partId) === selectedValue) : null;
        resolvedPartId = styleOpt ? (styleOpt.partId || selectedValue) : selectedValue;
        let partObj = allParts.find((p) => p.id === resolvedPartId || p.itemId === resolvedPartId || p.legacyErpId === resolvedPartId)
          || finishes.find((f) => f.id === resolvedPartId) || outsourceFinishes.find((f) => f.id === resolvedPartId)
          || findLibPart(resolvedPartId) || (styleOpt ? findLibPart(styleOpt.partName) : null);

        const preSizeObj = partObj;
        if (partObj) { const sizedPart = sizeBundle.swap(partObj); if (sizedPart !== partObj) { partObj = sizedPart; resolvedPartId = sizedPart.itemId || sizedPart.id; } }
        const sizeSwapped = partObj !== preSizeObj;
        if (partObj) { const sp = speciesSwap(partObj, finishObjForStep(step.id)); if (sp !== partObj) { partObj = sp; resolvedPartId = sp.itemId || sp.id; } }
        const preVariantObj = partObj;
        if (partObj && (partObj.legacyErpId || partObj.itemId)) { const variant = finishVariantOf(partObj, finishCodeForStep(step.id)); if (variant !== partObj) { partObj = variant; resolvedPartId = variant.itemId || variant.id; } }
        resolvedErpId = (partObj && (partObj.legacyErpId || partObj.itemId)) || (styleOpt && styleOpt.legacyErpId) || null;
        if (isFeePart(partObj, styleOpt)) lineIsFee = true;
        if (partObj) itemName = `${step.title} (${lineNameFor(partObj, styleOpt)})`;
        else if (styleOpt) itemName = `${step.title} (${styleOpt.partName})`;

        let optionNativePrice = 0;
        if (partObj) {
          if (partObj.manufacturingSpecs && partObj.manufacturingSpecs.basePrice) optionNativePrice = parseFloat(partObj.manufacturingSpecs.basePrice);
          else if (partObj.basePrice) optionNativePrice = parseFloat(partObj.basePrice);
        }
        if (!optionNativePrice && preVariantObj && preVariantObj !== partObj) {
          optionNativePrice = parseFloat((preVariantObj.manufacturingSpecs && preVariantObj.manufacturingSpecs.basePrice) != null ? preVariantObj.manufacturingSpecs.basePrice : preVariantObj.basePrice) || 0;
        }
        if (styleOpt && styleOpt.price !== undefined && styleOpt.price !== '' && parseFloat(styleOpt.price) > 0 && !sizeSwapped) optionNativePrice = parseFloat(styleOpt.price) || 0;

        if (step.linkedItemId) {
          const linkedSized = sizeBundle.swap(findLibPart(step.linkedItemId));
          if (linkedSized) {
            const selFinish = finishes.find((f) => f.id === selectedValue) || outsourceFinishes.find((f) => f.id === selectedValue);
            const fc = selFinish ? String(selFinish.code || selFinish.name || '').toUpperCase() : finishCodeForStep(step.id);
            const linkedBase = speciesSwap(linkedSized, selFinish || finishObjForStep(step.id));
            const linkedPart = finishVariantOf(linkedBase, fc);
            const fabLp = priceLevel !== 'STANDARD' ? fabricutPriceOf(linkedPart, priceLevel, fc) : null;
            const lp = fabLp != null ? fabLp : (parseFloat((linkedPart.manufacturingSpecs && linkedPart.manufacturingSpecs.basePrice) != null ? linkedPart.manufacturingSpecs.basePrice : linkedPart.basePrice) || parseFloat((linkedBase.manufacturingSpecs && linkedBase.manufacturingSpecs.basePrice) != null ? linkedBase.manufacturingSpecs.basePrice : linkedBase.basePrice) || 0);
            if (optionNativePrice === 0 && stepPrice === 0 && lp > 0) optionNativePrice = lp;
            resolvedPartId = linkedPart.itemId || linkedPart.id;
            resolvedErpId = linkedPart.legacyErpId || linkedPart.itemId || resolvedErpId;
            itemName = `${step.title} (${lineNameFor(linkedPart, null)})`;
          }
        }
        if (step.useClientPricing) { const v = clientPriceFor(partObj) != null ? clientPriceFor(partObj) : clientPriceFor(preVariantObj); if (v != null) optionNativePrice = v; }
        if (priceLevel !== 'STANDARD') { const fp = fabricutPriceOf(partObj, priceLevel, finishCodeForStep(step.id)); if (fp != null) optionNativePrice = fp; }
        let upcharge = (step.priceMap && step.priceMap[selectedValue]) ? (parseFloat(step.priceMap[selectedValue]) || 0) : 0;
        stepPrice += optionNativePrice + upcharge;
        if (partObj && partObj.multiplier && parseFloat(partObj.multiplier) > 1.0) multiplier = parseFloat(partObj.multiplier);
      }

      if (step.priceOverride !== undefined && step.priceOverride !== '') stepPrice = parseFloat(step.priceOverride);
      const lineTotal = stepPrice * multiplier * qty;
      if (lineTotal > 0 || stepPrice > 0 || step.type === 'STATIC_FEE' || (selectedValue && step.partHandling)) {
        breakdown.push({ name: itemName, qty, price: stepPrice * multiplier, total: lineTotal, isFee: lineIsFee });
      }
      total += lineTotal;
    }

    const subSel = params[`${step.id}__sub`];
    if (subSel && Array.isArray(step.subOptions)) {
      const subOpt = step.subOptions.find((o) => (o.optId || o.partId) === subSel);
      if (subOpt) {
        const subBase0 = findLibPart(subOpt.partId) || findLibPart(subOpt.partName);
        const subBase = speciesSwap(sizeBundle.swap(subBase0), finishObjForStep(step.id));
        const subSizeSwapped = subBase !== subBase0;
        const subPart = subBase ? finishVariantOf(subBase, finishCodeForStep(step.id)) : null;
        let subPrice = (subOpt.price !== undefined && subOpt.price !== '' && parseFloat(subOpt.price) > 0 && !subSizeSwapped)
          ? parseFloat(subOpt.price)
          : (subPart ? (parseFloat((subPart.manufacturingSpecs && subPart.manufacturingSpecs.basePrice) != null ? subPart.manufacturingSpecs.basePrice : subPart.basePrice) || 0) : 0);
        if (step.useClientPricing) { const v = clientPriceFor(subPart) != null ? clientPriceFor(subPart) : clientPriceFor(subBase); if (v != null) subPrice = v; }
        if (priceLevel !== 'STANDARD') { const fp = fabricutPriceOf(subPart, priceLevel); if (fp != null) subPrice = fp; }
        breakdown.push({ name: `${step.subLabel || 'Backplate'} (${subPart ? lineNameFor(subPart, subOpt) : subOpt.partName})`, qty, price: subPrice, total: subPrice * qty });
        total += subPrice * qty;
      }
    }
  });

  return { lines: breakdown, total };
}

module.exports = { computePricing, sizeSelectionsOf, returnsAllowedFor, isReturnOption, partAllowedAtSize, buildSizeIndex, PRICE_LEVELS, SIZE_STEP_TYPE };
