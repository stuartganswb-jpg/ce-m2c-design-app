// Shared/hardwareSession — the configuration without the screen (PORTAL, 2026-10-12).
//   node scripts/hardwareSession.test.mjs
//
// Two halves, the way hardwareAutoPicks.test.mjs is built. The RULES: what each piece must do. The MOVE: the CPQ
// screen's inline code as it stood before it moved to Shared/hardwareSession is kept below, verbatim, and must agree
// with the module on every set-up — of the live H1-2TRV pins, and of a small assembly that asks the rod diameter
// first — the proof that moving it changed nothing the CPQ screen does.
//
// SESSION_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor, finishesFor } from '../src/components/Shared/hardwareModel.js';
import { choicesFromAssembly, modelNodesOf } from '../src/components/Shared/hardwareAdapter.js';
import { autoPicksOf } from '../src/components/Shared/hardwareAutoPicks.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from '../src/components/Shared/bracketSpan.js';
import { carrierRows } from '../src/components/Shared/traverseConfigurator.js';
import { usageAt } from '../src/components/Shared/traverseExplode.js';
import { rodMaterialsOf, extrasForRod, liveExtrasOf } from '../src/components/Shared/flowExtras.js';
import { normalizeExtras } from '../src/components/Shared/extrasRestore.js';
import { settleVision } from '../src/components/Shared/visionEngine.js';
import { wearsAsTwin } from '../src/components/Shared/materialTwin.js';
import { subFinishOfFinish } from '../src/components/Shared/subFinish.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel, buildSizeSteps } from '../src/components/Shared/sizeMatrix.js';
import { ENGINE_DOORS, engineClosure } from './sync-engine.mjs';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const S = await import(process.env.SESSION_MODULE || new URL('../src/components/Shared/hardwareSession.js', import.meta.url).href);
const { partIndexOf, partIn, ourNumberOf, sizeStepsOf, sizeSelOf, sizeIndexOf, choicesAtSize, sizeProjInchesOf, answersAtSize, settle, sessionOf,
    lengthInchesOf, lengthFeetExactOf, lengthFeetOf, lengthFieldsOf, bracketAdviceOf, recommendedFor, quantitiesOf, resolvedOf,
    spliceCodesAmong, singleSpliceOf, spliceLimitOf, spliceIsNeeded, sameItem, spliceIsSatisfied, withRequiredSplice,
    globalFinishOf, finishIndexOf, materialOfFinish, withGlobalFinish, wearsAsTwinFinish, wearsFinishOf, globalFinishForChoice, chosenListOf, partFinishByPartOf,
    armFinishOfChoice, finishForChoice, matchFinishOverrideOf, isFeeRecord, rodFinishForChoice, followsRodChoice, subFinishForChoice, lineFinishForChoice,
    textureOverridesOf, chosenFinishObjectsOf, bareWoodOf, clientFinishNameOf, offeredFinishesOf, finishGroupsOf, finishGroupLabel, finishRulesOf } = S;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 300)}\n    want ${String(w).slice(0, 300)}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
// A model holds Sets and Maps (what is visible, who owns a node) — said as plain data so two models compare whole.
const canon = (v) => JSON.stringify(v, (k, x) => (x instanceof Set ? { set: [...x].sort() } : x instanceof Map ? { map: [...x.entries()].map(([a, b]) => [a, b && b.id ? b.id : b]) } : x));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CPQ SCREEN'S INLINE CODE, AS IT STOOD (HardwareConfigurator.js @ 55beadf8) — verbatim, kept as the reference.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const oldPartIndex = (parts) => {
    const m = new Map();
    parts.forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
        const kk = String(k || '').trim().toUpperCase();
        if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
    }));
    return m;
};
const oldFindPartIn = (partIndex) => (id) => partIndex.get(String(id || '').trim().toUpperCase()) || null;
const oldOurIdWith = (findPart) => (id) => {
    const pt = findPart(id);
    const legacy = String(pt?.legacyErpId || '').trim();
    if (legacy && legacy.toUpperCase() !== 'PENDING') return legacy;
    return String(pt?.itemId || id || '').trim();
};
// sizeSteps → sizeSel → sizeIndex → choices → sizeProjInches → effAnswers, exactly the screen's memo chain.
const oldSizes = ({ assembly, pins, parts, flow, sizePick, answers, findPart }) => {
    const sizeSteps = (flow?.steps || []).filter(st => st?.type === SIZE_STEP_TYPE);
    const sizeSel = (sizeSteps.length ? sizeSelectionsOf(flow, sizePick) : null);
    const sizeIndex = (sizeSel ? buildSizeIndex(parts) : null);
    const choices = (() => {
        const raw = choicesFromAssembly(assembly, pins);
        if (!sizeSel || !sizeIndex) return raw;
        const returnsOk = returnsAllowedFor(sizeSel);
        const out = [];
        raw.forEach(c => {
            if (!returnsOk && c.role === 'RETURN') return;
            const part = findPart(c.partId);
            if (!part) { out.push(c); return; }
            if (!partAllowedAtSize(part, sizeSel, sizeIndex)) return;
            const swapped = sizeVariantOf(part, sizeSel, sizeIndex);
            out.push(swapped.swapped && swapped.part ? { ...c, partId: swapped.part.id } : c);
        });
        return out;
    })();
    const sizeProjInches = (sizeSel ? projInchesOfSel(sizeSel) : null);
    const effAnswers = (sizeProjInches != null ? { ...answers, proj: sizeProjInches } : answers);
    return { sizeSteps, sizeSel, sizeIndex, choices, sizeProjInches, effAnswers };
};
const oldModel = ({ choices, effAnswers, picks, modelNodes }) => {
    const resolvePicks = (m, raw) => reseatPicks(m, raw);
    let sel = Object.values(picks).filter(Boolean);
    let m = resolve({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
    for (let pass2 = 0; pass2 < 4; pass2++) {
        const next = Object.values(resolvePicks(m, picks));
        if (next.length === sel.length && next.every(id => sel.includes(id))) break;
        sel = next;
        m = resolve({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
    }
    return m;
};

// move 2 — length, the bracket advice, the counts (the memos lengthInches / advice / recommendFor / quantities / resolved)
const oldLength = (poleIn, poleFrac) => {
    const lengthInches = (() => {
        const whole = parseFloat(poleIn);
        const m = String(poleFrac).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        const frac = m ? Number(m[1]) / Number(m[2]) : (parseFloat(poleFrac) || 0);
        const total = (Number.isFinite(whole) ? whole : 0) + (Number.isFinite(frac) ? frac : 0);
        return total > 0 ? total : null;
    })();
    const lengthFeetExact = lengthInches ? Math.round((lengthInches / 12) * 100) / 100 : null;
    const lengthFeet = lengthInches ? Math.ceil(lengthInches / 12) : null;
    return { lengthInches, lengthFeetExact, lengthFeet };
};
const oldReopenLength = (s) => {            // the Edit restore, as it set the two fields
    let poleIn, poleFrac;
    if (Number(s.lengthInches) > 0) {
        const whole = Math.floor(Number(s.lengthInches));
        const frac = Number(s.lengthInches) - whole;
        poleIn = String(whole);
        poleFrac = frac > 0.001 ? `${Math.round(frac * 16)}/16` : '';
    } else { poleIn = ''; poleFrac = ''; }
    return { poleIn, poleFrac };
};
const oldCounts = ({ model, livePicks, lengthInches, lengthFeet, spanMap, spanCaps, fabricId, ourId, stepQty, trvRules, choices: chs, effAnswers, modelNodes: nodes }) => {
    const advice = (() => {
        const ids = new Set(Object.values(livePicks));
        const rod = model.choices.find(c => ids.has(c.id) && ['ROD', 'FASCIA', 'TRACK'].includes(c.role));
        if (!rod || !lengthInches) return null;
        return bracketAdviceFor({ itemCode: ourId(rod.partId) || rod.name || rod.partId, map: spanMap, caps: spanCaps, rodInches: lengthInches, fabricId, dropFt: DEFAULT_DROP_FT });
    })();
    const recommendFor = (slot, choice) => {
        if (!slot) return null;
        if (slot.kind === 'BRACKET' && String(slot.position || '').toUpperCase() === 'CENTER') {
            return advice ? centreBracketsFor(advice.brackets, bearingEnds(model.choices, Object.values(livePicks), model.slots)) : null;
        }
        return recommendedQty(choice, lengthFeet);
    };
    const quantities = (() => {
        const q = {};
        model.slots.forEach(sl => {
            const id = livePicks[sl.key];
            if (!id) return;
            const typed = Number(stepQty[sl.key]);
            if (typed > 0) { q[id] = typed; return; }
            const rec = recommendFor(sl, sl.options.find(o => o.id === id));
            if (rec != null && rec > 0) q[id] = rec;
        });
        (model.riders || []).forEach(r => {
            const row = (r.role === 'CARRIER' && lengthFeet > 0 && trvRules)
                ? carrierRows(trvRules).find(u => String(u.itemId || '').trim().toUpperCase() === String(ourId(r.partId) || '').trim().toUpperCase()) : null;
            const rec = row ? usageAt(row, Math.max(lengthFeet, 2)) : recommendedQty(r, lengthFeet);
            if (rec) q[r.id] = rec;
        });
        return q;
    })();
    const resolved = resolve({ choices: chs, answers: effAnswers, selectedIds: Object.values(livePicks), modelNodes: nodes, quantities });
    return { advice, quantities, resolved, recommendFor };
};

// move 3 — the splice rule (spliceCodesIn / spliceCode / spliceOverIn / spliceNeeded / sameItemCode / spliceSatisfied and the
// one row the length step adds itself), with the screen's effect run to rest the way React runs it.
const oldSplice = ({ offeredExtraItems, typedExtras, extraItems, rodMats, flow, lengthInches, findPart, spliceWaived }) => {
    const spliceCodesIn = (items) => {
        const out = [];
        for (const it of (items || [])) {
            const part = findPart(it.code);
            const hay = `${it.code || ''} ${it.label || ''} ${part?.itemName || ''} ${part?.manufacturingSpecs?.productType || ''} ${part?.customData?.feeType || ''}`.toUpperCase();
            if (/SPLICE|JOINER|JNR|SPLC/.test(hay)) out.push(it.code);
        }
        return out;
    };
    const spliceCodes = spliceCodesIn(offeredExtraItems);
    const spliceCode = spliceCodes.length === 1 ? spliceCodes[0] : null;
    const spliceOverIn = Number(flow?.spliceOverInches) > 0 ? Number(flow.spliceOverInches) : 120;
    const spliceNeeded = spliceCodes.length > 0 && !!lengthInches && lengthInches > spliceOverIn;
    const sameItemCode = (a, b) => {
        if (String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase()) return true;
        const pa = findPart(a), pb = findPart(b);
        return !!(pa && pb && pa.id && pa.id === pb.id);
    };
    let typed = typedExtras, renders = 0;
    for (; renders < 5; renders++) {                    // the effect, until it changes nothing (it must rest after one add)
        if (!spliceNeeded || !spliceCode || spliceWaived) break;
        const next = ((a) => (a.some(x => sameItemCode(x.code, spliceCode) && Number(x.qty) > 0) ? a : [...a.filter(x => !sameItemCode(x.code, spliceCode)), { code: spliceCode, qty: '1', note: '' }]))(typed);
        if (next === typed) break;
        typed = next;
    }
    const extras = liveExtrasOf(typed, extraItems, rodMats);
    const spliceSatisfied = spliceCodes.some(c => extras.some(x => sameItemCode(x.code, c) && Number(x.qty) > 0));
    return { spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied, typed, extras, renders };
};

// The finish rules, as the screen held them (HardwareConfigurator.js @ cf3db903) — every memo and callback of the
// block, in its order, closed over the same things; a memo is a value here and a callback a function, nothing else.
const oldFinish = ({ finishes, flowFinishes, customer, customerId, findPart, model, resolved, livePicks, extras, globalFinishes, partFinish }) => {
    const globalFinish = globalFinishes.METAL || Object.values(globalFinishes).find(Boolean) || '';
    const finishByCode = (() => {
        const m = new Map();
        finishes.forEach(f => { const k = String(f.code || f.name || '').toUpperCase(); if (k) m.set(k, f); });
        return m;
    })();
    const matOfFinish = (f) => String((f && (f.material || f.type)) || 'METAL').toUpperCase();
    const twinWear = (c, f) => !!c && !!f && !c.noFinish && !finishesFor(c, [f]).length
        && wearsAsTwin(findPart(c.partId), f, findPart);
    const wearsFinish = (c, f) => !!c && !!f && (finishesFor(c, [f]).length > 0 || twinWear(c, f));
    const globalFinishFor = (c) => {
        const picks = Object.values(globalFinishes).map(code => [String(code || '').toUpperCase(), finishByCode.get(String(code || '').toUpperCase())]).filter(([, f]) => f);
        const asTwin = picks.find(([, f]) => twinWear(c, f));
        if (asTwin) return asTwin[0];
        for (const [code, f] of picks) if (finishesFor(c, [f]).length) return code;
        return '';
    };
    const chosenList = [...resolved.choices.filter(c => Object.values(livePicks).includes(c.id)), ...resolved.riders, ...resolved.companions];
    const partFinishByPart = (() => {
        const m = {};
        Object.entries(partFinish).forEach(([id, code]) => {
            const c = model.choices.find(x => x.id === id);
            if (c?.partId) m[String(c.partId).toUpperCase()] = code;
        });
        return m;
    })();
    const armFinishOf = (c) => {
        if (!c || c.role !== 'BACKPLATE') return '';
        const pos = String(c.position || '').toUpperCase();
        const pickAt = (kind) => {
            const sl = resolved.slots.find(x => x.kind === kind && String(x.position || '').toUpperCase() === pos);
            const id = sl ? livePicks[sl.key] : '';
            return id ? (sl.options || []).find(o => o.id === id) || null : null;
        };
        const end = pickAt('END');
        const arm = (end && ['RETURN', 'INSIDE_MOUNT'].includes(end.role)) ? end : pickAt('BRACKET');
        if (!arm) return '';
        return partFinish[arm.id] || partFinishByPart[String(arm.partId || '').toUpperCase()] || '';
    };
    const finishFor = (c) => partFinish[c.id] || armFinishOf(c) || globalFinishFor(c);
    const matchFinishOverride = (() => {
        const out = {};
        const isFeePart = (p) => !!(p && (p.partClass === 'Fee'
            || String(p.manufacturingSpecs?.productType || p.productType || '').toUpperCase() === 'FEE'));
        const feeSlots = new Set(extras
            .filter(x => Number(x.qty) > 0 && x.slot && isFeePart(findPart(x.code)))
            .map(x => x.slot));
        if (!feeSlots.size) return out;
        const fascia = chosenList.find(c => c.role === 'FASCIA');
        const code = fascia ? finishFor(fascia) : globalFinish;
        if (!code) return out;
        model.slots.filter(s => s.kind === 'TRACK' && feeSlots.has(s.key)).forEach(s => {
            const pick = livePicks[s.key];
            if (pick) out[pick] = code;
        });
        return out;
    })();
    const isFeeRecord = (p) => !!(p && (p.partClass === 'Fee'
        || String(p.manufacturingSpecs?.productType || p.productType || '').toUpperCase() === 'FEE'));
    const rodFinishFor = (choice) => {
        const rods = chosenList.filter(c => ['ROD', 'FASCIA'].includes(c.role));
        if (!rods.length) return '';
        const tier = String((choice && choice.tier) || '').toUpperCase();
        const rod = (tier && rods.find(r => String(r.tier || '').toUpperCase() === tier)) || rods[0];
        return String(partFinish[rod.id] || partFinishByPart[String(rod.partId || '').toUpperCase()] || globalFinishFor(rod) || '').toUpperCase();
    };
    const followsRod = (choice) => !!choice && choice.role === 'RETURN' && isFeeRecord(findPart(choice.partId));
    const subFinishFor = (choice, part) => {
        if (!choice) return '';
        const takes = choice.role === 'TRACK' || !!(part || findPart(choice.partId))?.manufacturingSpecs?.usesSubFinish;
        if (!takes) return '';
        const subOf = (code) => subFinishOfFinish(code, [finishByCode.get(String(code || '').toUpperCase())].filter(Boolean));
        return subOf(rodFinishFor(choice)) || subOf(globalFinish);
    };
    const lineFinishFor = (choice) => {
        if (choice && matchFinishOverride[choice.id]) return matchFinishOverride[choice.id];
        if (choice && choice.role === 'TRACK') return '';
        if (!choice || choice.noFinish) return '';
        if (followsRod(choice)) return partFinish[choice.id] || rodFinishFor(choice);
        if (choice.role !== 'TRACK' && findPart(choice.partId)?.manufacturingSpecs?.usesSubFinish
            && !partFinish[choice.id] && !partFinishByPart[String(choice.partId || '').toUpperCase()]) return '';
        const code = partFinish[choice.id] || partFinishByPart[String(choice.partId || '').toUpperCase()] || armFinishOf(choice) || globalFinishFor(choice);
        if (!code) return '';
        const f = finishByCode.get(String(code).toUpperCase());
        if (!f || !wearsFinish(choice, f)) return '';
        return code;
    };
    const textureOverrides = (() => {
        const out = {};
        const chosenIds = new Set(chosenList.map(c => c.id));
        const byPart = new Map();
        chosenList.forEach(c => { if (c.partId) byPart.set(String(c.partId).toUpperCase(), c); });
        (resolved.visible ? [...resolved.visible] : []).forEach(node => {
            const owner = resolved.ownership?.owner?.get(node);
            if (!owner) return;
            const c = chosenIds.has(owner.id) ? owner
                : (owner.partId ? byPart.get(String(owner.partId).toUpperCase()) : null);
            const ov = c && (matchFinishOverride[c.id] || matchFinishOverride[owner.id]);
            if (!c || ((c.noFinish || owner.noFinish) && !ov)) return;
            if (!ov && (c.role === 'TRACK' || owner.role === 'TRACK')) return;
            const follows = !ov && followsRod(c);
            const f = finishByCode.get(String(ov || (follows ? (partFinish[c.id] || rodFinishFor(c)) : finishFor(c))).toUpperCase());
            if (!f || (!ov && !follows && !wearsFinish(c, f))) return;
            const url = f.textureUrl || f.finalImageUrl;
            if (url) out[String(node).toLowerCase()] = url;
        });
        return out;
    })();
    const chosenFinishObjects = (() => {
        const codes = new Set([...Object.values(globalFinishes), ...Object.values(partFinish)].filter(Boolean).map(c => String(c).toUpperCase()));
        return [...codes].map(c => finishByCode.get(c)).filter(Boolean);
    })();
    const clientFinishName = (f) => {
        if (!customerId && !customer) return '';
        const keys = new Set([customerId, customer?.name, customer?.companyName].filter(Boolean).map(v => String(v).trim().toUpperCase()));
        const hit = (Array.isArray(f.clientMapping) ? f.clientMapping : []).find(m => keys.has(String(m.customerId || '').trim().toUpperCase()));
        return hit?.clientFinishName || '';
    };
    const offeredFinishes = (flowFinishes.length
        ? finishes.filter(f => flowFinishes.includes(f.code || f.finishCode || f.name || f.id))
        : finishes);
    const finishGroups = (() => {
        const usable = offeredFinishes.filter(f => !chosenList.length || chosenList.some(c => wearsFinish(c, f)));
        const byMat = new Map();
        usable.forEach(f => {
            const m = String(f.material || f.type || 'METAL').toUpperCase();
            if (!byMat.has(m)) byMat.set(m, { inHouse: [], out: [] });
            const splits = !m.includes('WOOD');
            const out = splits && (f.multiplier !== undefined || f.vendor);
            (out ? byMat.get(m).out : byMat.get(m).inHouse).push(f);
        });
        return [...byMat.entries()];
    })();
    const groupLabel = (mat, kind) => {
        const m = String(mat || '').toUpperCase();
        if (m.includes('WOOD')) return 'Wood';
        if (m.includes('METAL')) return kind === 'out' ? 'Plated' : 'Painted';
        if (m.includes('BRASS')) return 'Solid brass';
        return kind === 'out' ? 'Outsourced' : 'In house';
    };
    // (in addConfiguration) the wood parts that would leave with no stain
    const bareWood = chosenList.filter(c => Array.isArray(c.materials) && c.materials.includes('WOOD') && !c.noFinish && !finishFor(c));
    // setGlobalFinish, as the reducer it was: a single code lands in its material's slot; blank clears every default
    const setGlobalFinish = (prev, code) => {
        const c = String(code || '').toUpperCase();
        if (!c) return {};
        const f = finishByCode.get(c);
        return { ...prev, [matOfFinish(f)]: c };
    };
    return { globalFinish, finishByCode, matOfFinish, twinWear, wearsFinish, globalFinishFor, chosenList, partFinishByPart, armFinishOf, finishFor, matchFinishOverride, isFeeRecord,
        rodFinishFor, followsRod, subFinishFor, lineFinishFor, textureOverrides, chosenFinishObjects, clientFinishName, offeredFinishes, finishGroups, groupLabel, bareWood, setGlobalFinish };
};

// ── THE RULES: how a part is found ────────────────────────────────────────────────────────────
{
    const a = { id: 'CE-INV-1', itemId: 'ce-inv-1', legacyErpId: ' h1-138be ' };
    const b = { id: 'CE-INV-2', itemId: 'CE-INV-2', legacyErpId: 'PENDING' };
    const c = { id: 'CE-INV-3', itemId: 'CE-INV-3', legacyErpId: 'H1-138BE' };       // the same number, later — the first keeps it
    const ix = partIndexOf([a, b, c]);
    ok('a part is found by its record id, its item id or OUR number, in any case', partIn(ix, 'ce-inv-1') === a && partIn(ix, ' H1-138BE') === a && partIn(ix, 'CE-INV-3') === c);
    ok('the first record to claim a number keeps it', partIn(ix, 'h1-138be') === a);
    ok("'PENDING' is nobody's number", partIn(ix, 'PENDING') === null && partIn(ix, 'pending') === null);
    ok('an unknown or empty id finds nothing', partIn(ix, 'NOPE') === null && partIn(ix, '') === null && partIn(ix, null) === null);
    ok('no parts at all is an empty index, not a crash', partIndexOf(undefined).size === 0 && partIndexOf([]).size === 0);
    eq('OUR number is legacyErpId, trimmed', ourNumberOf(a, 'CE-INV-1'), 'h1-138be');
    eq('an item not numbered yet prints its item id, never PENDING', ourNumberOf(b, 'CE-INV-2'), 'CE-INV-2');
    eq('a part the library does not hold prints what the pin said', ourNumberOf(null, ' CE-INV-9 '), 'CE-INV-9');
    eq('nothing in, nothing out', ourNumberOf(null, undefined), '');
}

// ── A SIZE WORLD: one flow that asks the rod diameter and the projection first (the real H2-RND rules, made-up codes) ──
const DIAS = ['05', '75', '1', '138'];
const sizeParts = [];
const mk = (code, base, extra = {}) => ({ id: `ID-${code}`, itemId: `ID-${code}`, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: { basePrice: base }, ...extra });
const fam = (style, base, only = DIAS) => only.forEach(d => sizeParts.push(mk(`H2-${d}${style}`, base)));
fam('R', 12); fam('F', 30); fam('AF', 55, ['138']); fam('BE', 22); fam('BP', 6, ['75', '1', '138']);
sizeParts.push(mk('H2-MRF', 40, { partClass: 'Fee' }));
const cl = (id, category, position) => ({ id, name: id, category, position, location: 'WALL', nodes: [`${id}_mesh`] });
const SIZE_ASM = { id: 'ASM-SIZE', itemName: 'H2-SIZE', nodeClusters: [cl('C-ROD', 'POLE', 'CENTER'), cl('C-FL', 'FINIAL', 'LEFT'), cl('C-BL', 'BRACKET', 'LEFT'), cl('C-PL', 'BACKPLATE', 'LEFT')] };
let pinNo = 0;
const pin = (clusterId, code, extra = {}) => ({ id: `PIN-${++pinNo}-${code}`, assemblyId: 'ASM-SIZE', clusterId, partId: `ID-${code}`, partName: code, targetNode: `${clusterId}_mesh`, defaultQty: 1, choiceSort: pinNo, ...extra });
const SIZE_PINS = [
    pin('C-ROD', 'H2-75R'), pin('C-FL', 'H2-75F', { endTreatment: 'FINIAL' }), pin('C-FL', 'H2-138AF', { endTreatment: 'FINIAL' }), pin('C-FL', 'H2-MRF', { endTreatment: 'MITER_RETURN' }),
    pin('C-BL', 'H2-75BE', { projInches: '3.625' }), pin('C-BL', 'H2-75BE', { projInches: '4.625' }), pin('C-BL', 'H2-75BE', { projInches: '6' }),
    pin('C-PL', 'H2-75BP'), pin('C-PL', 'NOT-IN-LIBRARY'),
];
const SIZE_FLOW = { id: 'FLOW-SIZE', steps: buildSizeSteps('H2-RND') };
const sizeFind = (id) => partIn(partIndexOf(sizeParts), id);
const at = (dia, proj) => {
    const sizePick = { ...(dia ? { 'SIZE-DIA': `SIZE-DIA-${dia}` } : {}), ...(proj ? { 'SIZE-PROJ': `SIZE-PROJ-${proj}` } : {}) };
    const sizeSteps = sizeStepsOf(SIZE_FLOW);
    const sizeSel = sizeSelOf(SIZE_FLOW, sizePick, sizeSteps);
    const sizeIndex = sizeIndexOf(sizeSel, sizeParts);
    return { sizePick, sizeSel, sizeIndex, choices: choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel, sizeIndex, findPart: sizeFind }), proj: sizeProjInchesOf(sizeSel) };
};
const codesOf = (choices) => choices.map(c => (sizeFind(c.partId) || {}).legacyErpId || c.partId);
{
    eq('the size steps are the flow\'s SIZE_SELECT steps, and only those', sizeStepsOf({ steps: [{ type: 'STYLE_SWAP' }, ...SIZE_FLOW.steps, null] }).map(s => s.id), ['SIZE-DIA', 'SIZE-PROJ']);
    ok('a flow with no size steps has no size selection, no index', sizeSelOf({ steps: [] }, {}, []) === null && sizeIndexOf(null, sizeParts) === null && sizeProjInchesOf(null) === null);
    const plain = choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel: null, sizeIndex: null, findPart: sizeFind });
    eq('…and its choices are the pins as tagged, untouched', plain, choicesFromAssembly(SIZE_ASM, SIZE_PINS));
    const answers = { rodKind: 'SOLID' };
    ok('…and its answers are the SAME object — nothing to re-render', answersAtSize(answers, null) === answers);
    eq('an unanswered size quotes the family\'s base cell (3/4" × 4-5/8")', [at().sizeSel.dia, at().sizeSel.proj, at().proj], ['75', 'E', 4.625]);
    eq('at 1-3/8" every part is the 1-3/8" item — the swap is on the CHOICE', codesOf(at('138', 'E').choices).filter(c => /^H2-/.test(c)).every(c => /^H2-138|^H2-MRF/.test(c)), true);
    const asTagged = new Map(choicesFromAssembly(SIZE_ASM, SIZE_PINS).map(c => [c.id, c]));
    ok('…and nothing else about the choice moves — its id, its nodes, its tags (the render is the master, scaled)',
        DIAS.every(d => at(d, 'E').choices.every(c => JSON.stringify({ ...c, partId: '' }) === JSON.stringify({ ...asTagged.get(c.id), partId: '' }))));
    ok('a part made only at 1-3/8" is offered there', codesOf(at('138', 'E').choices).includes('H2-138AF'));
    ok('…and nowhere else', !codesOf(at('1', 'E').choices).some(c => /AF$/.test(c)) && !codesOf(at('05', 'S').choices).some(c => /AF$/.test(c)));
    ok('a return needs depth: offered at 4-5/8", not at 3-5/8"', at('75', 'E').choices.some(c => c.role === 'RETURN') && !at('75', 'S').choices.some(c => c.role === 'RETURN'));
    ok('no 1/2" plate exists, so the plate stays the base item rather than vanishing', codesOf(at('05', 'S').choices).includes('H2-75BP'));
    ok('a part the library does not hold passes through for the diagnostics', at('1', 'E').choices.some(c => c.partId === 'ID-NOT-IN-LIBRARY'));
    eq('the matrix answers the projection: 3-5/8, 4-5/8, 6', [at('75', 'S').proj, at('75', 'E').proj, at('138', '6').proj], [3.625, 4.625, 6]);
    eq('a projection the diameter does not make is healed (6" at 3/4" → 4-5/8")', at('75', '6').sizeSel.proj, 'E');
    const eff = answersAtSize(answers, 6);
    ok('the matrix\'s projection overrides the engine\'s own, on a copy', eff.proj === 6 && eff.rodKind === 'SOLID' && answers.proj === undefined);
}

// ── THE MOVE, sizes: the module against the screen's old memo chain, every diameter × projection ──────────────
{
    let compared = 0, differ = 0;
    const picksList = [{}, ...DIAS.flatMap(d => ['P75', 'S', 'E', '6'].map(p => ({ 'SIZE-DIA': `SIZE-DIA-${d}`, 'SIZE-PROJ': `SIZE-PROJ-${p}` }))), { 'SIZE-DIA': 'SIZE-DIA-138' }, { 'SIZE-PROJ': 'SIZE-PROJ-S' }, { 'SIZE-DIA': 'nonsense' }];
    for (const flow of [SIZE_FLOW, { id: 'no-size', steps: [] }, null]) {
        for (const sizePick of picksList) {
            for (const answers of [{}, { rodKind: 'SOLID', proj: 3.625 }]) {
                const oldFind = oldFindPartIn(oldPartIndex(sizeParts));
                const o = oldSizes({ assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow, sizePick, answers, findPart: oldFind });
                const sizeSteps = sizeStepsOf(flow);
                const sizeSel = sizeSelOf(flow, sizePick, sizeSteps);
                const sizeIndex = sizeIndexOf(sizeSel, sizeParts);
                const n = { sizeSteps, sizeSel, sizeIndex, choices: choicesAtSize({ assembly: SIZE_ASM, pins: SIZE_PINS, sizeSel, sizeIndex, findPart: sizeFind }), sizeProjInches: sizeProjInchesOf(sizeSel) };
                n.effAnswers = answersAtSize(answers, n.sizeProjInches);
                compared++;
                if (canon(o) !== canon(n) || (o.effAnswers === answers) !== (n.effAnswers === answers)) differ++;
            }
        }
    }
    eq(`sizes: the module agrees with the old inline code on every size (${compared} compared)`, differ, 0);
}

// ── THE MOVE, the settle: the live H1-2TRV pins, every framing, picks that agree and picks a later answer overturns ──
const choices = choicesFromAssembly(ASSEMBLY, PINS);
const modelNodes = modelNodesOf(ASSEMBLY);
const modelOf = (answers, picks) => resolve({ choices, answers, selectedIds: Object.values(picks).filter(Boolean), modelNodes });
const framings = [];
(function walk(answers) {
    const open = modelOf(answers, {}).axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null);
    if (!open) { framings.push(answers); return; }
    open.values.forEach(v => walk({ ...answers, [open.key]: v }));
})({});
const rng = (seed) => { let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; };
const picksFor = (answers, seed) => {
    const rand = rng(seed); let picks = {};
    for (let guard = 0; guard < 40; guard++) {
        const m = modelOf(answers, picks);
        picks = reseatPicks(m, picks);
        const slot = m.slots.find(s => !picks[s.key] && s.options.length && !s.suppressedBy);
        if (!slot) break;
        picks[slot.key] = slot.options[Math.floor(rand() * slot.options.length)].id;
    }
    return picks;
};
{
    ok(`the fixture offers real framings to walk (${framings.length})`, framings.length >= 8);
    let compared = 0, differ = 0, vision = 0, moved = 0, onePassWrong = 0;
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 4; v++) {
            const agree = picksFor(answers, `${fi}|${v}`);
            // the same parts under the NEXT framing's answers, and under one answer changed — picks a later choice overturns
            const sets = [[answers, agree], [framings[(fi + 1) % framings.length], agree], [{ ...answers, proj: answers.proj === 6 ? 3.625 : 6 }, agree], [answers, {}]];
            for (const [ans, picks] of sets) {
                const o = oldModel({ choices, effAnswers: ans, picks, modelNodes });
                const n = settle({ choices, answers: ans, picks, modelNodes });
                compared++;
                if (canon(o) !== canon(n)) differ++;
                if (canon(settleVision({ choices, answers: ans, picks, modelNodes }).model) !== canon(n)) vision++;
                const live = reseatPicks(n, picks);
                if (Object.keys(picks).some(k => live[k] !== picks[k])) moved++;
                if (canon(modelOf(ans, picks)) !== canon(n)) onePassWrong++;
            }
        }
    });
    eq(`settle: the module agrees with the old inline loop on every set-up (${compared} compared)`, differ, 0);
    eq('…and with Vision\'s own copy of the same loop (Shared/visionEngine.settleVision)', vision, 0);
    ok(`the set-ups really overturn picks — in ${moved} a pick was removed or moved to its twin`, moved > 20);
    ok(`…and settling matters: in ${onePassWrong} of them one pass over the raw picks gives a different model`, onePassWrong > 0);
    const calm = picksFor(framings[0], 'calm');
    eq('nothing to drop → exactly the one resolve it always was', canon(settle({ choices, answers: framings[0], picks: calm, modelNodes })), canon(modelOf(framings[0], calm)));
    eq('nothing picked → the open model', canon(settle({ choices, answers: {}, picks: {}, modelNodes })), canon(modelOf({}, {})));
    eq('an un-pick (a blank) is not a pick', canon(settle({ choices, answers: framings[0], picks: { ...calm, 'RING|FRONT|SHARED': '' }, modelNodes })), canon(settle({ choices, answers: framings[0], picks: Object.fromEntries(Object.entries(calm).filter(([k]) => k !== 'RING|FRONT|SHARED')), modelNodes })));
}

// ── THE RULES: length ─────────────────────────────────────────────────────────────────────────
{
    eq('whole inches and a fraction, typed the way an installer measures', [lengthInchesOf('96', '1/2'), lengthInchesOf('96', ' 3 / 16 '), lengthInchesOf('96.25', ''), lengthInchesOf('', '7/8'), lengthInchesOf('90', '0.5')], [96.5, 96.1875, 96.25, 0.875, 90.5]);
    eq('nothing typed, or nothing that is a length, is no length', [lengthInchesOf('', ''), lengthInchesOf('abc', 'x'), lengthInchesOf('0', '0'), lengthInchesOf(undefined, undefined)], [null, null, null, null]);
    eq('WE BILL IN FULL FEET, ROUNDED UP — a quarter inch over is the next foot', [lengthFeetOf(96), lengthFeetOf(96.25), lengthFeetOf(90.5), lengthFeetOf(0.875), lengthFeetOf(null)], [8, 9, 8, 1, null]);
    eq('the exact feet beside it, to the hundredth', [lengthFeetExactOf(90.5), lengthFeetExactOf(96), lengthFeetExactOf(null)], [7.54, 8, null]);
    eq('a saved length goes back into whole inches and sixteenths', [lengthFieldsOf(96), lengthFieldsOf(96.5), lengthFieldsOf(96.3), lengthFieldsOf('120.25'), lengthFieldsOf(95.99)], [{ poleIn: '96', poleFrac: '' }, { poleIn: '96', poleFrac: '8/16' }, { poleIn: '96', poleFrac: '5/16' }, { poleIn: '120', poleFrac: '4/16' }, { poleIn: '95', poleFrac: '16/16' }]);
    eq('…and no saved length is two empty fields', [lengthFieldsOf(0), lengthFieldsOf(null), lengthFieldsOf('x'), lengthFieldsOf(-4)], Array(4).fill({ poleIn: '', poleFrac: '' }));
    const back = (x) => { const f = lengthFieldsOf(x); return lengthInchesOf(f.poleIn, f.poleFrac); };
    eq('a length in sixteenths comes back exactly; anything finer comes back as the nearest sixteenth', [back(96), back(60.5), back(119.9375), back(96.3), back(95.99)], [96, 60.5, 119.9375, 96.3125, 96]);
}

// ── THE MOVE, length: every way the two fields can be typed, and every saved length ──────────────────────────
{
    let compared = 0, differ = 0;
    const ins = ['', '0', '36', '96', '96.25', '119', 'abc', ' 120 ', '-5', undefined, null, 144];
    const fracs = ['', '1/2', '15/16', ' 3 / 8 ', '0.5', '16/16', 'x', '1/0', undefined, null, 0.25];
    for (const a of ins) for (const b of fracs) {
        const n = { lengthInches: lengthInchesOf(a, b) }; n.lengthFeetExact = lengthFeetExactOf(n.lengthInches); n.lengthFeet = lengthFeetOf(n.lengthInches);
        compared++; if (canon(oldLength(a, b)) !== canon({ lengthInches: n.lengthInches, lengthFeetExact: n.lengthFeetExact, lengthFeet: n.lengthFeet })) differ++;
    }
    for (const L of [0, null, undefined, '', 'x', -3, 36, 60.5, 96, 96.3, '120.25', 119.9375, 95.99, 132.25, 180, 0.0005, 1e6]) {
        compared++; if (canon(oldReopenLength({ lengthInches: L })) !== canon(lengthFieldsOf(L))) differ++;
    }
    eq(`length: the module agrees with the old inline code (${compared} compared)`, differ, 0);
}

// ── THE RULES + THE MOVE, counts: the live H1-2TRV pins at varied lengths, fabric weights, typed counts ────────
{
    const SPAN = { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' };
    const CAPS = { 'H1-ALU2': { maxSpan: 48 } };
    const RULES = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 6: 24, 8: 32, 12: 48 } }, { label: 'Wall brackets', itemId: 'H1-2TRV-WB', byFeet: { 4: 2 } }], configurator: [] };
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    const ix = partIndexOf(parts); const find = (id) => partIn(ix, id); const ourId = (id) => ourNumberOf(find(id), id);
    let compared = 0, differ = 0, withAdvice = 0, charted = 0, typedWins = 0, centre = 0;
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 3; v++) {
            const picks = picksFor(answers, `counts|${fi}|${v}`);
            const model = settle({ choices, answers, picks, modelNodes });
            const { livePicks } = autoPicksOf({ model, answers, operatorPicks: reseatPicks(model, picks) });
            const countable = model.slots.filter(sl => livePicks[sl.key] && (sl.kind === 'RING' || sl.kind === 'BRACKET'));
            for (const L of [null, 18, 60.5, 96, 144.25]) {
                for (const world of [{ spanMap: {}, spanCaps: {}, trvRules: null }, { spanMap: SPAN, spanCaps: {}, trvRules: RULES }, { spanMap: SPAN, spanCaps: CAPS, trvRules: RULES }]) {
                    for (const fabricId of ['PRINT', 'BLACKOUT']) {
                        const stepQty = (v === 2 && countable.length) ? { [countable[0].key]: '7', [countable[countable.length - 1].key]: '0' } : {};
                        const f = lengthFieldsOf(L); const lengthInches = lengthInchesOf(f.poleIn, f.poleFrac); const lengthFeet = lengthFeetOf(lengthInches);
                        const o = oldCounts({ model, livePicks, lengthInches, lengthFeet, ...world, fabricId, ourId, stepQty, choices, effAnswers: answers, modelNodes });
                        const advice = bracketAdviceOf({ model, livePicks, lengthInches, spanMap: world.spanMap, spanCaps: world.spanCaps, fabricId, ourId });
                        const recommendFor = (slot, choice) => recommendedFor({ slot, choice, advice, model, livePicks, lengthFeet });
                        const quantities = quantitiesOf({ model, livePicks, stepQty, lengthFeet, recommendFor, trvRules: world.trvRules, ourId });
                        const resolved = resolvedOf({ choices, answers, livePicks, modelNodes, quantities });
                        compared++;
                        if (canon(o.advice) !== canon(advice) || canon(o.quantities) !== canon(quantities) || canon(o.resolved) !== canon(resolved)
                            || model.slots.some(sl => o.recommendFor(sl, sl.options[0]) !== recommendFor(sl, sl.options[0])) || o.recommendFor(null) !== recommendFor(null)) differ++;
                        if (advice) withAdvice++;
                        if (world.trvRules && (model.riders || []).some(r => r.role === 'CARRIER' && quantities[r.id] === usageAt(RULES.usage[0], Math.max(lengthFeet, 2)) && lengthFeet > 0)) charted++;
                        if (stepQty[countable[0]?.key] && quantities[livePicks[countable[0].key]] === 7) typedWins++;
                        if (advice && model.slots.some(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && quantities[livePicks[sl.key]] > 1)) centre++;
                    }
                }
            }
        }
    });
    eq(`counts: the module agrees with the old inline code on every set-up (${compared} compared)`, differ, 0);
    ok(`the set-ups reach the rules: a span recommendation in ${withAdvice}, the carriers chart in ${charted}, a typed count winning in ${typedWins}, more than one centre bracket in ${centre}`, withAdvice > 50 && charted > 20 && typedWins > 20 && centre > 5);
    const model = settle({ choices, answers: framings[0], picks: {}, modelNodes });
    eq('no rod chosen, or no length → no recommendation, honestly', [bracketAdviceOf({ model, livePicks: {}, lengthInches: 96, spanMap: SPAN, spanCaps: {}, fabricId: 'PRINT', ourId }), recommendedFor({ slot: null })], [null, null]);
    eq('a centre bracket with no span to go on is not guessed', recommendedFor({ slot: { kind: 'BRACKET', position: 'center' }, choice: {}, advice: null, model, livePicks: {}, lengthFeet: 8 }), null);
}

// ── THE RULES + THE MOVE, the splice: one joiner, several, none; under and over the limit; typed, doubled, declined ──
{
    const lib = [
        { id: 'CE-INV-900', itemId: 'CE-INV-900', legacyErpId: 'H1-138JNR', itemName: 'Joiner for 1-3/8" round' },
        { id: 'CE-INV-901', itemId: 'CE-INV-901', legacyErpId: 'H1-1JNR', itemName: 'Connector 1"', manufacturingSpecs: { productType: 'Splice' } },
        { id: 'CE-FEE-7', itemId: 'CE-FEE-7', legacyErpId: 'CE-FEE-7', itemName: 'Cut charge', customData: { feeType: 'splc' } },
        { id: 'CE-INV-902', itemId: 'CE-INV-902', legacyErpId: 'H1-RNGX', itemName: 'Extra rings' },
    ];
    const ix = partIndexOf(lib); const find = (id) => partIn(ix, id);
    eq('a splice is found by what the ITEM says it is — its name, its product type, its fee type, its label or code', spliceCodesAmong([{ code: 'H1-138JNR' }, { code: 'H1-1JNR' }, { code: 'CE-FEE-7' }, { code: 'H1-RNGX' }, { code: 'X1', label: 'Pole splice' }, { code: 'ZJNR9' }], find), ['H1-138JNR', 'H1-1JNR', 'CE-FEE-7', 'X1', 'ZJNR9']);
    eq('no items, no splice', [spliceCodesAmong([], find), spliceCodesAmong(null, find)], [[], []]);
    eq('ONE candidate is added by the step; several are the operator\'s to choose', [singleSpliceOf(['A']), singleSpliceOf(['A', 'B']), singleSpliceOf([])], ['A', null, null]);
    eq('the limit is the flow\'s, 120" where it names none', [spliceLimitOf({ spliceOverInches: 96 }), spliceLimitOf({ spliceOverInches: '108' }), spliceLimitOf({}), spliceLimitOf(null), spliceLimitOf({ spliceOverInches: 0 })], [96, 108, 120, 120, 120]);
    eq('needed only OVER the limit, and only when a joiner is offered', [spliceIsNeeded(['A'], 120, 120), spliceIsNeeded(['A'], 120.25, 120), spliceIsNeeded([], 180, 120), spliceIsNeeded(['A'], null, 120)], [false, true, false, false]);
    ok('the same item under either of its names — our number or the record id, in any case', sameItem('h1-138jnr', 'CE-INV-900', find) && sameItem(' H1-138JNR ', 'H1-138JNR', find) && !sameItem('H1-138JNR', 'H1-1JNR', find) && !sameItem('NOPE', 'ALSO-NOPE', find) && sameItem('nope', 'NOPE', find));
    const same = (a, b) => sameItem(a, b, find);
    const has = [{ code: 'CE-INV-900', qty: '1', note: 'left' }];
    ok('a joiner already on the list is left alone — the SAME list, nothing to re-render', withRequiredSplice(has, 'H1-138JNR', same) === has);
    eq('none on the list → one, at 1, last', withRequiredSplice([{ code: 'H1-RNGX', qty: '4', note: '' }], 'H1-138JNR', same), [{ code: 'H1-RNGX', qty: '4', note: '' }, { code: 'H1-138JNR', qty: '1', note: '' }]);
    eq('taken off at 0 → put back at 1, once (its old row goes)', withRequiredSplice([{ code: 'CE-INV-900', qty: '0', note: 'x' }], 'H1-138JNR', same), [{ code: 'H1-138JNR', qty: '1', note: '' }]);
    ok('satisfied by any of the candidates, under any of its names, at a count above 0', spliceIsSatisfied(['H1-138JNR', 'H1-1JNR'], [{ code: 'CE-INV-901', qty: '2' }], same) && !spliceIsSatisfied(['H1-138JNR'], [{ code: 'CE-INV-900', qty: '0' }], same) && !spliceIsSatisfied([], has, same));

    let compared = 0, differ = 0, added = 0, rested = 0, waived = 0, several = 0;
    const itemSets = [[], [{ code: 'H1-138JNR', label: 'Joiner' }], [{ code: 'H1-138JNR', label: 'Joiner' }, { code: 'H1-1JNR', label: 'Joiner 1"' }], [{ code: 'H1-RNGX', label: 'Extra rings' }], [{ code: 'H1-138JNR', label: 'Wood joiner', rodMaterials: ['WOOD'] }, { code: 'H1-RNGX', label: 'Rings' }]];
    const typedSets = [[], [{ code: 'H1-138JNR', qty: '1', note: '18 in from left' }], [{ code: 'CE-INV-900', qty: '2', note: '' }], [{ code: 'H1-138JNR', qty: '0', note: '' }], [{ code: 'H1-RNGX', qty: '6', note: '' }, { code: 'h1-138jnr', qty: '1', note: '' }]];
    for (const extraItems of itemSets) for (const typed0 of typedSets) for (const L of [null, 96, 120, 120.0625, 180]) for (const flow of [null, {}, { spliceOverInches: 96 }]) for (const rodMats of [[], ['METAL'], ['WOOD']]) for (const spliceWaived of [false, true]) {
        const offeredExtraItems = extrasForRod(extraItems, rodMats);
        const typedExtras = normalizeExtras(typed0, extraItems, find);
        const o = oldSplice({ offeredExtraItems, typedExtras, extraItems, rodMats, flow, lengthInches: L, findPart: find, spliceWaived });
        const spliceCodes = spliceCodesAmong(offeredExtraItems, find);
        const spliceCode = singleSpliceOf(spliceCodes);
        const spliceOverIn = spliceLimitOf(flow);
        const spliceNeeded = spliceIsNeeded(spliceCodes, L, spliceOverIn);
        let typed = typedExtras;
        if (spliceNeeded && spliceCode && !spliceWaived) typed = withRequiredSplice(typed, spliceCode, same);
        const extras = liveExtrasOf(typed, extraItems, rodMats);
        const n = { spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied: spliceIsSatisfied(spliceCodes, extras, same), typed, extras };
        compared++;
        if (canon({ ...o, renders: 0 }) !== canon({ ...n, renders: 0 })) differ++;
        if (typed !== typedExtras) added++;
        if (o.renders <= 1) rested++;
        if (spliceNeeded && spliceCode && spliceWaived && !n.spliceSatisfied) waived++;
        if (spliceNeeded && !spliceCode) several++;
    }
    eq(`the splice: the module agrees with the old inline code, effect and all (${compared} compared)`, differ, 0);
    ok(`the set-ups reach the rule: the step added a joiner in ${added}, a declined one stayed off in ${waived}, several candidates left to the operator in ${several}`, added > 20 && waived > 5 && several > 5);
    eq('the effect rests after ONE add — it can never loop', rested, compared);
}

// ── THE RULES, finishes: each rule on parts made for the purpose ───────────────────────────────────────────────
const FIN = [
    { id: 'F-P14', code: 'P14', name: 'Matte Black', material: 'METAL', textureUrl: 't://p14', subFinishCode: 'TBR', clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Black' }] },
    { id: 'F-EP4', code: 'EP4', name: 'Polished Nickel', material: 'METAL', textureUrl: 't://ep4', vendor: 'PLATER', subFinishCode: 'TCP' },
    { id: 'F-S04', code: 'S04', name: 'Natural Oak', material: 'WOOD', textureUrl: 't://s04', bomSuffix: 'OAK', subFinishCode: 'TCP' },
    { id: 'F-S11', code: 'S11', name: 'Dark Walnut', material: 'WOOD', textureUrl: 't://s11', vendor: 'STAINER' },
    { id: 'F-LBR', code: 'LBR', name: 'Live Solid Brass', material: 'BRASS', textureUrl: 't://lbr', clientMapping: [{ customerId: 'cust-1', clientFinishName: 'Solid Brass' }] },
    { id: 'F-PEW', name: 'Antique Pewter', type: 'metal', finalImageUrl: 'i://pewter' },
    { id: 'F-X90', code: 'X90', name: 'Stone', material: 'STONE', multiplier: 2 },
];
{
    const ix = finishIndexOf(FIN);
    const fin = (code) => ix.get(code);
    eq('the one code for the readers that want one: the METAL default, else whichever is set, else none',
        [globalFinishOf({ METAL: 'P14', WOOD: 'S04' }), globalFinishOf({ WOOD: 'S04' }), globalFinishOf({ METAL: '', BRASS: 'LBR' }), globalFinishOf({})], ['P14', 'S04', 'LBR', '']);
    eq('finishes are found by code — or by name where there is no code — whatever the case', [[...ix.keys()], ix.get('ANTIQUE PEWTER').id, finishIndexOf([{ code: 'p14' }, {}]).has('P14')], [['P14', 'EP4', 'S04', 'S11', 'LBR', 'ANTIQUE PEWTER', 'X90'], 'F-PEW', true]);
    eq('a finish belongs to a material: its own, the older field, else METAL', [materialOfFinish(fin('S04')), materialOfFinish(fin('ANTIQUE PEWTER')), materialOfFinish({ type: 'wood' }), materialOfFinish({ code: 'Q' }), materialOfFinish(undefined)], ['WOOD', 'METAL', 'WOOD', 'METAL', 'METAL']);
    eq('a single code lands in its material\'s slot, beside the others', [withGlobalFinish({ METAL: 'P14' }, 's04', ix), withGlobalFinish({ METAL: 'P14' }, 'EP4', ix), withGlobalFinish({}, 'Antique Pewter', ix), withGlobalFinish({}, 'ZZ9', ix)],
        [{ METAL: 'P14', WOOD: 'S04' }, { METAL: 'EP4' }, { METAL: 'ANTIQUE PEWTER' }, { METAL: 'ZZ9' }]);
    eq('…and a blank clears every default', withGlobalFinish({ METAL: 'P14', WOOD: 'S04' }, '', ix), {});

    // parts: a steel bracket also made in brass, one that is not, a wood finial, a clear one, a fee, a stock-colour bracket
    const lib = [
        { id: 'D-BS', legacyErpId: 'BS', manufacturingSpecs: { customData: { materialTwins: [{ material: 'BRASS', code: 'BBS' }] } } }, { id: 'D-BBS', legacyErpId: 'BBS', manufacturingSpecs: {} },
        { id: 'D-BE', legacyErpId: 'BE', manufacturingSpecs: {} }, { id: 'D-MRF', legacyErpId: 'MRF', partClass: 'Fee', manufacturingSpecs: {} },
        { id: 'D-FRF', legacyErpId: 'FRF', manufacturingSpecs: { productType: 'fee' } }, { id: 'D-CR', legacyErpId: 'CR', manufacturingSpecs: {} },
        { id: 'D-WB', legacyErpId: 'WB', manufacturingSpecs: { usesSubFinish: true } }, { id: 'D-FEE', legacyErpId: 'PAINT-FEE', partClass: 'Fee', manufacturingSpecs: {} },
        { id: 'D-JNR', legacyErpId: 'JNR', manufacturingSpecs: {} },
    ];
    const find = (id) => partIn(partIndexOf(lib), id);
    const bs = { id: 'c-bs', partId: 'D-BS', role: 'BRACKET', position: 'LEFT', materials: [] };
    const be = { id: 'c-be', partId: 'D-BE', role: 'BRACKET', position: 'RIGHT', materials: ['METAL'] };
    const wf = { id: 'c-wf', partId: 'D-WF', role: 'FINIAL', materials: ['WOOD'], name: 'Wood finial' };
    const af = { id: 'c-af', partId: 'D-AF', role: 'FINIAL', materials: ['CLEAR'], noFinish: true };
    const twinWear = (c, f) => wearsAsTwinFinish(c, f, find);
    const wears = (c, f) => wearsFinishOf(c, f, twinWear);
    eq('a part wears a finish of its own material (blank = metal)', [wears(bs, fin('P14')), wears(be, fin('EP4')), wears(wf, fin('S04')), wears(wf, fin('P14')), wears(be, fin('S04'))], [true, true, true, false, false]);
    eq('…and of a material its library record names a twin in — "it is just the parts listed"', [twinWear(bs, fin('LBR')), wears(bs, fin('LBR')), twinWear(be, fin('LBR')), wears(be, fin('LBR')), twinWear(bs, fin('P14'))], [true, true, false, false, false]);
    eq('a part tagged no-finish wears nothing, on either path', [wears(af, fin('P14')), wearsAsTwinFinish({ ...bs, noFinish: true }, fin('LBR'), find), wears(null, fin('P14')), wears(bs, null)], [false, false, false, false]);
    const gf = (c, g) => globalFinishForChoice(c, { globalFinishes: g, finishByCode: ix, twinWear });
    eq('the default a part wears: its material\'s — and a twin finish outranks it', [gf(bs, { METAL: 'P14', BRASS: 'LBR' }), gf(be, { METAL: 'P14', BRASS: 'LBR' }), gf(wf, { METAL: 'P14', BRASS: 'LBR' }), gf(wf, { METAL: 'P14', WOOD: 's04' }), gf(be, { METAL: 'NOPE' }), gf(be, {})],
        ['LBR', 'P14', '', 'S04', '', '']);
    const mdl = { choices: [bs, be, wf, af] };
    eq('an exception travels by PART number, not by the pin clicked', partFinishByPartOf({ 'c-bs': 'EP4', 'c-gone': 'P14' }, mdl), { 'D-BS': 'EP4' });
    eq('the chosen parts: the picks in the model\'s order, then the riders that always come, then the collars they bring', chosenListOf({ choices: [bs, be, wf], riders: [{ id: 'rider' }], companions: [{ id: 'collar' }] }, { x: 'c-wf', y: 'c-bs' }).map(c => c.id), ['c-bs', 'c-wf', 'rider', 'collar']);

    // a plate follows the arm at its position: the bracket — or the return / inside mount that took that end
    const ret = { id: 'c-ret', partId: 'D-MRF', role: 'RETURN', position: 'LEFT' };
    const cast = { id: 'c-cast', partId: 'D-CR', role: 'RETURN', position: 'LEFT' };
    const finl = { id: 'c-fin', partId: 'D-F', role: 'FINIAL', position: 'LEFT' };
    const plL = { id: 'c-pl', partId: 'D-BP', role: 'BACKPLATE', position: 'left' };
    const plR = { id: 'c-pr', partId: 'D-BP', role: 'BACKPLATE', position: 'RIGHT' };
    const slots = (endPick) => [{ kind: 'BRACKET', position: 'LEFT', key: 'B|L', options: [bs] }, { kind: 'BRACKET', position: 'RIGHT', key: 'B|R', options: [be] }, { kind: 'END', position: 'LEFT', key: 'E|L', options: [ret, cast, finl] }];
    const arm = (c, livePicks, partFinish) => armFinishOfChoice(c, { resolved: { slots: slots() }, livePicks, partFinish, partFinishByPart: partFinishByPartOf(partFinish, { choices: [bs, be, ret, cast, finl] }) });
    eq('a plate wears its arm\'s finish — the bracket at its own position, by the pin or by the part', [arm(plL, { 'B|L': 'c-bs' }, { 'c-bs': 'EP4' }), arm(plR, { 'B|R': 'c-be' }, { 'c-bs': 'EP4' }), arm(plR, { 'B|R': 'c-be' }, { 'c-be': 'P14' })], ['EP4', '', 'P14']);
    eq('…the return or inside mount where one has taken that end, not the bracket behind it', [arm(plL, { 'B|L': 'c-bs', 'E|L': 'c-ret' }, { 'c-bs': 'EP4', 'c-ret': 'P14' }), arm(plL, { 'B|L': 'c-bs', 'E|L': 'c-ret' }, { 'c-bs': 'EP4' }), arm(plL, { 'B|L': 'c-bs', 'E|L': 'c-fin' }, { 'c-bs': 'EP4', 'c-fin': 'P14' })], ['P14', '', 'EP4']);
    eq('only a plate follows an arm, and only where there is one', [arm(bs, { 'B|L': 'c-bs' }, { 'c-bs': 'EP4' }), arm(plL, {}, { 'c-bs': 'EP4' }), arm(null, {}, {})], ['', '', '']);
    eq('what a part is wearing: its own, else its arm\'s, else the default', ['own', 'arm', 'def', ''].map((want) => finishForChoice({ id: 'c' }, { partFinish: want === 'own' ? { c: 'own' } : {}, armFinishOf: () => (want === 'def' || want === '' ? '' : 'arm'), globalFinishFor: () => (want === '' ? '' : 'def') })), ['own', 'arm', 'def', '']);

    // paint-to-match: a FEE ticked on a TRACK step dresses that track in what the fascia wears
    const fascia = { id: 'c-fa', partId: 'D-FA', role: 'FASCIA', tier: 'FRONT', materials: ['WOOD'] };
    const tmodel = { slots: [{ kind: 'TRACK', key: 'T|F' }, { kind: 'TRACK', key: 'T|B' }, { kind: 'BRACKET', key: 'B|L' }] };
    const match = (extras, extra = {}) => matchFinishOverrideOf({ extras, findPart: find, chosenList: [fascia], finishFor: () => 'S04', globalFinish: 'P14', model: tmodel, livePicks: { 'T|F': 'trk-f', 'T|B': 'trk-b', 'B|L': 'c-bs' }, ...extra });
    eq('a fee ticked on ONE track paints that track in the fascia\'s finish', match([{ code: 'PAINT-FEE', qty: '1', slot: 'T|F' }]), { 'trk-f': 'S04' });
    eq('…each track is its own tick', match([{ code: 'PAINT-FEE', qty: '1', slot: 'T|F' }, { code: 'PAINT-FEE', qty: '2', slot: 'T|B' }]), { 'trk-f': 'S04', 'trk-b': 'S04' });
    eq('not at 0, not an item that is no fee, not a fee ticked on another step, not with no slot', [match([{ code: 'PAINT-FEE', qty: '0', slot: 'T|F' }]), match([{ code: 'JNR', qty: '1', slot: 'T|F' }]), match([{ code: 'PAINT-FEE', qty: '1', slot: 'B|L' }]), match([{ code: 'PAINT-FEE', qty: '1' }])], [{}, {}, {}, {}]);
    eq('no fascia chosen → the configuration\'s one code; nothing to wear → nothing', [match([{ code: 'PAINT-FEE', qty: '1', slot: 'T|F' }], { chosenList: [] }), match([{ code: 'PAINT-FEE', qty: '1', slot: 'T|F' }], { chosenList: [], globalFinish: '' }), match([{ code: 'PAINT-FEE', qty: '1', slot: 'T|F' }], { livePicks: {} })], [{ 'trk-f': 'P14' }, {}, {}]);

    // a return cut into the pole follows the pole — of its own tier on a double
    const rodF = { id: 'r-f', partId: 'D-RF', role: 'ROD', tier: 'FRONT' }, rodB = { id: 'r-b', partId: 'D-RB', role: 'FASCIA', tier: 'back' };
    const rodFin = (choice, partFinish = {}, list = [rodF, rodB]) => rodFinishForChoice(choice, { chosenList: [bs, ...list], partFinish, partFinishByPart: partFinishByPartOf(partFinish, { choices: list }), globalFinishFor: (c) => (c.id === 'r-b' ? 's11' : 'p14') });
    eq('the pole of the same tier; the first pole where the return names none', [rodFin({ tier: 'BACK' }), rodFin({ tier: 'FRONT' }), rodFin({}), rodFin({ tier: 'MIDDLE' }), rodFin(null)], ['S11', 'P14', 'P14', 'P14', 'P14']);
    eq('the pole\'s own exception first — by its pin, or by its part', [rodFin({ tier: 'BACK' }, { 'r-b': 'ep4' }), rodFin({ tier: 'BACK' }, { 'r-b2': 'EP4' }, [rodF, rodB, { id: 'r-b2', partId: 'D-RB', role: 'ROD', tier: 'X' }]), rodFin({ tier: 'BACK' }, {}, [])], ['EP4', 'EP4', '']);
    eq('a fee is a fee by its class or its product type', [isFeeRecord(find('MRF')), isFeeRecord(find('FRF')), isFeeRecord(find('CR')), isFeeRecord(null), isFeeRecord({ productType: 'Fee' })], [true, true, false, false, true]);
    eq('only a RETURN that is a fee follows the pole — a cast return bracket keeps its own material', [followsRodChoice(ret, find), followsRodChoice(cast, find), followsRodChoice({ role: 'FINIAL', partId: 'D-MRF' }, find), followsRodChoice(null, find)], [true, false, false, false]);

    // the stock colour: the pole's finish first, the configuration's otherwise; only a track or a part the library says
    const sub = (choice, part, rod, g) => subFinishForChoice(choice, part, { findPart: find, finishByCode: ix, rodFinishFor: () => rod, globalFinish: g });
    eq('a track is made in the stock colour aligned to the POLE\'s finish, else the configuration\'s', [sub({ role: 'TRACK' }, null, 'S04', 'P14'), sub({ role: 'TRACK' }, null, '', 'P14'), sub({ role: 'TRACK' }, null, 'S11', 'P14'), sub({ role: 'TRACK' }, null, '', '')], ['TCP', 'TBR', 'TBR', '']);
    eq('…and so is a part the library says is — by the record handed in, or found', [sub({ role: 'BRACKET', partId: 'D-WB' }, null, 'S04', ''), sub({ role: 'BRACKET', partId: 'D-BE' }, null, 'S04', ''), sub({ role: 'BRACKET', partId: 'D-BE' }, find('WB'), '', 'EP4'), sub(null, null, 'S04', 'P14')], ['TCP', '', 'TCP', '']);

    // what a line is billed and sprayed in
    const line = (choice, o = {}) => lineFinishForChoice(choice, { partFinish: {}, partFinishByPart: {}, armFinishOf: () => '', globalFinishFor: () => 'P14', finishByCode: ix, matchFinishOverride: {}, followsRod: (c) => followsRodChoice(c, find), rodFinishFor: () => 'S04', findPart: find, wearsFinish: wears, ...o });
    eq('the default, past the material gate', [line(be), line(wf), line(af), line(null)], ['P14', '', '', '']);
    eq('its own exception, the same part\'s exception, its arm\'s — in that order', [line(be, { partFinish: { 'c-be': 'EP4' }, partFinishByPart: { 'D-BE': 'P14' }, armFinishOf: () => 'P14' }), line(be, { partFinishByPart: { 'D-BE': 'EP4' }, armFinishOf: () => 'ANTIQUE PEWTER' }), line(be, { armFinishOf: () => 'EP4' })], ['EP4', 'EP4', 'EP4']);
    eq('a code that is no finish, or one the part cannot wear, is nothing', [line(be, { partFinish: { 'c-be': 'NOPE' } }), line(be, { partFinish: { 'c-be': 'S04' } }), line(be, { partFinish: { 'c-be': 'LBR' } }), line(bs, { partFinish: { 'c-bs': 'LBR' } }), line(be, { globalFinishFor: () => '' })], ['', '', '', 'LBR', '']);
    eq('a track never takes the configuration finish — only the paint-to-match upcharge paints it', [line({ id: 'trk', role: 'TRACK' }), line({ id: 'trk', role: 'TRACK' }, { partFinish: { trk: 'P14' } }), line({ id: 'trk', role: 'TRACK' }, { matchFinishOverride: { trk: 'S04' } }), line({ id: 'x', role: 'RING', noFinish: true }, { matchFinishOverride: { x: 'S04' } })], ['', '', 'S04', 'S04']);
    eq('a return cut into the pole: the pole\'s finish past the gate, its own pick first; a cast return keeps the rule', [line(ret), line(ret, { partFinish: { 'c-ret': 'EP4' } }), line(cast), line(ret, { rodFinishFor: () => '' })], ['S04', 'EP4', 'P14', '']);
    eq('a stock-colour part is not repainted uninvited — only by a finish picked for IT (its pin or its part)', [line({ id: 'w', role: 'BRACKET', partId: 'D-WB' }), line({ id: 'w', role: 'BRACKET', partId: 'D-WB' }, { partFinish: { w: 'EP4' } }), line({ id: 'w', role: 'BRACKET', partId: 'D-WB' }, { partFinishByPart: { 'D-WB': 'EP4' } }), line({ id: 'w', role: 'BRACKET', partId: 'D-WB' }, { armFinishOf: () => 'EP4' })], ['', 'EP4', 'EP4', '']);

    // the render: every visible node, by the part that owns it
    const seg = { id: 'r-seg', partId: 'D-RF', role: 'ROD' }, clearSeg = { id: 'r-seg2', partId: 'D-RF', role: 'ROD', noFinish: true }, trk = { id: 'trk', partId: 'D-T', role: 'TRACK' }, stray = { id: 'zz', partId: 'D-ZZ', role: 'RING' };
    const tex = (o = {}) => textureOverridesOf({ resolved: { visible: new Set(['Rod_L', 'Rod_Clear', 'Rod_Core', 'Fin', 'Clear', 'Ret', 'Trk', 'Stray', 'Nobody', 'Pew']), ownership: { owner: new Map([['Rod_L', seg], ['Rod_Clear', clearSeg], ['Rod_Core', rodF], ['Fin', wf], ['Clear', af], ['Ret', ret], ['Trk', trk], ['Stray', stray], ['Pew', be]]) } },
        chosenList: [rodF, wf, af, ret, trk, be], finishByCode: ix, finishFor: (c) => (c.id === 'c-wf' ? 'S04' : c.id === 'c-be' ? 'ANTIQUE PEWTER' : 'P14'), matchFinishOverride: {}, followsRod: (c) => followsRodChoice(c, find), rodFinishFor: () => 'S04', partFinish: {}, wearsFinish: wears, ...o });
    eq('each node is painted by the part that owns it; a segment by the chosen part it is a piece of; nothing lands on clear (a clear piece of a painted part included), a track, an unowned or unchosen node',
        tex(), { rod_l: 't://p14', rod_core: 't://p14', fin: 't://s04', ret: 't://s04', pew: 'i://pewter' });
    eq('a paint-matched track renders painted; a return\'s own pick beats the pole; the gate holds in the render', [tex({ matchFinishOverride: { trk: 'EP4' } }).trk, tex({ partFinish: { 'c-ret': 'EP4' } }).ret, tex({ finishFor: () => 'S04' }).rod_core, tex({ finishFor: () => 'S04' }).fin, tex({ resolved: {} })], ['t://ep4', 't://ep4', undefined, 't://s04', {}]);

    eq('the finishes on the order: the defaults and the exceptions, each once, only real ones', chosenFinishObjectsOf({ METAL: 'p14', WOOD: 'S04', BRASS: '' }, { a: 'S04', b: 'ep4', c: 'NOPE' }, ix).map(f => f.id), ['F-P14', 'F-S04', 'F-EP4']);
    eq('wood wears a stain or it does not leave: named when it wears nothing, not when it does, never a no-finish part', [bareWoodOf([be, wf, af, { ...wf, id: 'c-wf2', noFinish: true }, { id: 'legacy', materials: 'WOOD' }], () => '').map(c => c.id), bareWoodOf([wf], () => 'S04').length], [['c-wf'], 0]);
    eq('the customer\'s own word for a finish — matched by id, name or company, whatever the case', [clientFinishNameOf(fin('P14'), 'CUST-4720', { name: 'Fabricut' }), clientFinishNameOf(fin('P14'), 'CUST-4720', { companyName: ' fabricut ' }), clientFinishNameOf(fin('LBR'), 'CUST-1', null), clientFinishNameOf(fin('P14'), 'CUST-9', { name: 'Brimar' }), clientFinishNameOf(fin('P14'), '', null), clientFinishNameOf(fin('S04'), 'FABRICUT', null)],
        ['Black', 'Black', 'Solid Brass', '', '', '']);
    eq('a flow narrowed to its own finishes stays narrowed (by code, by name where there is no code); never narrowed = all', [offeredFinishesOf(FIN, ['P14', 'Antique Pewter', 'S04']).map(f => f.id), offeredFinishesOf(FIN, []).length], [['F-P14', 'F-S04', 'F-PEW'], FIN.length]);
    const groups = (list, chosen) => finishGroupsOf({ offeredFinishes: list, chosenList: chosen, wearsFinish: wears }).map(([m, g]) => [m, g.inHouse.map(f => f.id), g.out.map(f => f.id)]);
    eq('grouped by material; metal splits painted / plated, wood never splits; with nothing chosen everything is offered', groups(FIN, []),
        [['METAL', ['F-P14', 'F-PEW'], ['F-EP4']], ['WOOD', ['F-S04', 'F-S11'], []], ['BRASS', ['F-LBR'], []], ['STONE', [], ['F-X90']]]);
    eq('…and then the parts have their say: a finish no chosen part can wear is not offered', [groups(FIN, [be]), groups(FIN, [bs, wf]).map(g => g[0]), groups(FIN, [af])], [[['METAL', ['F-P14', 'F-PEW'], ['F-EP4']]], ['METAL', 'WOOD', 'BRASS'], []]);
    eq('the groups are named for what the finish IS', [finishGroupLabel('WOOD', 'out'), finishGroupLabel('METAL', 'in'), finishGroupLabel('metal', 'out'), finishGroupLabel('BRASS', 'out'), finishGroupLabel('STONE', 'out'), finishGroupLabel('STONE', 'in'), finishGroupLabel('', 'in')],
        ['Wood', 'Painted', 'Plated', 'Solid brass', 'Outsourced', 'In house', 'In house']);
}

// ── THE MOVE, finishes: the module against the screen's old block, on every part of every set-up ───────────────
// Two assemblies: the live H1-2TRV pins (tracks, a wood fascia, two tiers, rings, brackets made in a stock colour, one
// of them also made in brass) and a small one with what those pins lack — ends that are finials (wood, clear with a
// collar), a miter return that is a fee, a cast return that is not, an inside mount, and a plate behind every arm.
{
    const fcl = (id, category, position, extra = {}) => ({ id, name: id, category, position, location: 'WALL', nodes: [`${id}_mesh`], ...extra });
    const FIN_ASM = { id: 'ASM-FIN', itemName: 'FIN', nodeClusters: [fcl('F-ROD', 'POLE', 'CENTER'), fcl('F-EL', 'FINIAL', 'LEFT'), fcl('F-ER', 'FINIAL', 'RIGHT'),
        fcl('F-BL', 'BRACKET', 'LEFT'), fcl('F-BC', 'BRACKET', 'CENTER'), fcl('F-BR', 'BRACKET', 'RIGHT'), fcl('F-PL', 'BACKPLATE', 'LEFT'), fcl('F-PC', 'BACKPLATE', 'CENTER'), fcl('F-PR', 'BACKPLATE', 'RIGHT'), fcl('F-RG', 'RING', 'SHARED')] };
    let fp = 0;
    const fpin = (clusterId, code, extra = {}) => ({ id: `FPIN-${String(++fp).padStart(2, '0')}-${code}`, assemblyId: 'ASM-FIN', clusterId, partId: `FD-${code}`, partName: code, legacyErpId: code, targetNode: `${clusterId}_mesh`, defaultQty: 1, choiceSort: fp, ...extra });
    const endPins = (c) => [fpin(c, 'MF', { endTreatment: 'FINIAL' }), fpin(c, 'WF', { endTreatment: 'FINIAL', materials: 'WOOD', requiresCollar: 'COL' }), fpin(c, 'AF', { endTreatment: 'FINIAL', materials: 'CLEAR (NO FINISH)', requiresCollar: 'COL' }),
        fpin(c, 'COL', { endTreatment: 'FINIAL', isCollar: true }), fpin(c, 'MRF', { endTreatment: 'MITER_RETURN' }), fpin(c, 'CR', { endTreatment: 'FRENCH_RETURN' }), fpin(c, 'IM', { endTreatment: 'INSIDE_MOUNT' })];
    const FIN_PINS = [fpin('F-ROD', 'MR'), fpin('F-ROD', 'WR', { materials: 'WOOD' }), ...endPins('F-EL'), ...endPins('F-ER'),
        ...['F-BL', 'F-BC', 'F-BR'].flatMap(c => [fpin(c, 'BS'), fpin(c, 'BE')]), ...['F-PL', 'F-PC', 'F-PR'].flatMap(c => [fpin(c, 'BP'), fpin(c, 'BP2')]), fpin('F-RG', 'RG'), fpin('F-RG', 'WRG', { materials: 'WOOD' })];
    const part = (code, extra = {}) => ({ id: `FD-${code}`, itemId: `FD-${code}`, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: {}, ...extra });
    const FIN_PARTS = ['MR', 'WR', 'MF', 'WF', 'AF', 'COL', 'CR', 'IM', 'BE', 'BP', 'BP2', 'RG', 'WRG'].map(c => part(c))
        .concat([part('MRF', { partClass: 'Fee' }), part('BS', { manufacturingSpecs: { customData: { materialTwins: [{ material: 'BRASS', code: 'BBS' }] } } }), part('BBS'), part('PAINT-FEE', { partClass: 'Fee' })]);
    const trvParts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName, partClass: 'Inventory',
        manufacturingSpecs: { ...(/^H1-2TRV-(WB|EWB|6WB)$/.test(p.partName) ? { usesSubFinish: true } : {}), ...(p.partName === 'H1-2TRV-CB' ? { customData: { materialTwins: [{ material: 'BRASS', code: 'H1-2TRV-CB-BRS' }] } } : {}) } }])).values(),
        part('H1-2TRV-CB-BRS'), part('PAINT-FEE', { partClass: 'Fee' })];
    const WORLDS = [{ name: 'H1-2TRV', assembly: ASSEMBLY, pins: PINS, parts: trvParts }, { name: 'ends and plates', assembly: FIN_ASM, pins: FIN_PINS, parts: FIN_PARTS }];
    const GLOBALS = [{}, { METAL: 'P14' }, { METAL: 'EP4', WOOD: 'S04' }, { WOOD: 'S11' }, { METAL: 'P14', WOOD: 'S04', BRASS: 'LBR' }, { METAL: 'ANTIQUE PEWTER', BRASS: 'LBR' }];
    const CODES = ['P14', 'EP4', 'S04', 'S11', 'LBR', 'ANTIQUE PEWTER', 'NOPE'];
    const tally = { compared: 0, differ: 0, plateFollows: 0, returnArm: 0, followsRod: 0, backTier: 0, twin: 0, match: 0, stock: 0, bare: 0, collar: 0, textures: 0, gated: 0, byPart: 0 };
    const firstDiff = [];
    for (const w of WORLDS) {
        const chs = choicesFromAssembly(w.assembly, w.pins); const nodes = modelNodesOf(w.assembly);
        const find = (id) => partIn(partIndexOf(w.parts), id);
        const mOf = (answers, picks) => resolve({ choices: chs, answers, selectedIds: Object.values(picks).filter(Boolean), modelNodes: nodes });
        const frs = [];
        (function walk(answers) { const open = mOf(answers, {}).axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null); if (!open) { frs.push(answers); return; } open.values.forEach(v => walk({ ...answers, [open.key]: v })); })({});
        ok(`${w.name}: there are framings to walk (${frs.length})`, frs.length >= 1);
        frs.forEach((answers, fi) => {
            for (let v = 0; v < (w.name === 'H1-2TRV' ? 4 : 40); v++) {
                const rand = rng(`fin|${w.name}|${fi}|${v}`);
                let picks = {};
                for (let guard = 0; guard < 40; guard++) {
                    const m = mOf(answers, picks); picks = reseatPicks(m, picks);
                    const slot = m.slots.find(sl => !picks[sl.key] && sl.options.length && !sl.suppressedBy);
                    if (!slot) break;
                    picks[slot.key] = slot.options[Math.floor(rand() * slot.options.length)].id;
                }
                const model = settle({ choices: chs, answers, picks, modelNodes: nodes });
                const { livePicks } = autoPicksOf({ model, answers, operatorPicks: reseatPicks(model, picks) });
                const resolved = resolvedOf({ choices: chs, answers, livePicks, modelNodes: nodes, quantities: {} });
                const chosenIds = Object.values(livePicks);
                // exceptions on one, two or three of the chosen parts; the paint fee on a track, and sometimes where it arms nothing
                const partFinish = {};
                for (let k = 0; k < v % 4; k++) partFinish[chosenIds[Math.floor(rand() * chosenIds.length)]] = CODES[Math.floor(rand() * CODES.length)];
                const tracks = model.slots.filter(sl => sl.kind === 'TRACK' && livePicks[sl.key]);
                const extras = [...(tracks.length && v % 2 ? [{ code: 'PAINT-FEE', qty: '1', slot: tracks[v % tracks.length].key }] : []), ...(v % 3 === 0 ? [{ code: 'PAINT-FEE', qty: '1', slot: (model.slots.find(sl => sl.kind === 'BRACKET') || {}).key }] : [])];
                const globalFinishes = GLOBALS[(fi + v) % GLOBALS.length];
                const env = { finishes: FIN, flowFinishes: v % 5 === 4 ? ['P14', 'S04', 'LBR'] : [], customer: v % 2 ? { name: 'FABRICUT' } : null, customerId: v % 2 ? 'CUST-4720' : '', findPart: find, model, resolved, livePicks, extras };
                const o = oldFinish({ ...env, globalFinishes, partFinish });
                const n = finishRulesOf(env, { globalFinishes, partFinish });
                const all = [...model.choices, ...resolved.riders, ...resolved.companions];
                const said = (x) => JSON.stringify({
                    globalFinish: x.globalFinish, byPart: x.partFinishByPart, match: x.matchFinishOverride, tex: x.textureOverrides, on: x.chosenFinishObjects.map(f => f.id), offered: x.offeredFinishes.map(f => f.id),
                    groups: x.finishGroups.map(([m, g]) => [m, g.inHouse.map(f => f.id), g.out.map(f => f.id)]), bare: x.bareWood.map(c => c.id), chosen: x.chosenList.map(c => c.id), names: FIN.map(f => x.clientFinishName(f)),
                    per: all.map(c => [x.finishFor(c), x.lineFinishFor(c), x.subFinishFor(c), x.subFinishFor(c, find(c.partId)), x.armFinishOf(c), x.globalFinishFor(c), x.rodFinishFor(c), x.followsRod(c), FIN.map(f => (x.wearsFinish(c, f) ? 1 : 0) + (x.twinWear(c, f) ? 2 : 0)).join('')]) });
                tally.compared++;
                if (said(o) !== said(n)) { tally.differ++; if (firstDiff.length < 3) firstDiff.push(`${w.name} #${fi}.${v}`); }
                // …and the set-ups really do take each rule's road
                const chosen = n.chosenList;
                if (chosen.some(c => c.role === 'BACKPLATE' && n.armFinishOf(c))) tally.plateFollows++;
                if (chosen.some(c => c.role === 'BACKPLATE' && n.armFinishOf(c) && model.slots.some(sl => sl.kind === 'END' && String(sl.position || '').toUpperCase() === String(c.position || '').toUpperCase() && ['RETURN', 'INSIDE_MOUNT'].includes((sl.options.find(x => x.id === livePicks[sl.key]) || {}).role)))) tally.returnArm++;
                if (chosen.some(c => n.followsRod(c) && n.lineFinishFor(c))) tally.followsRod++;
                if (chosen.some(c => c.role === 'RETURN' && String(c.tier || '').toUpperCase() === 'BACK')) tally.backTier++;
                if (chosen.some(c => FIN.some(f => n.twinWear(c, f)) && n.lineFinishFor(c) === 'LBR')) tally.twin++;
                if (Object.keys(n.matchFinishOverride).length) tally.match++;
                if (chosen.some(c => n.subFinishFor(c))) tally.stock++;
                if (n.bareWood.length) tally.bare++;
                if (resolved.companions.length) tally.collar++;
                if (Object.keys(n.textureOverrides).length) tally.textures++;
                if (chosen.some(c => n.finishFor(c) && !n.lineFinishFor(c))) tally.gated++;
                if (Object.keys(n.partFinishByPart).length && chosen.some(c => !partFinish[c.id] && n.partFinishByPart[String(c.partId || '').toUpperCase()])) tally.byPart++;
            }
        });
    }
    eq(`finishes: the module agrees with the old inline block on every part of every set-up (${tally.compared} set-ups compared)${firstDiff.length ? ` — first: ${firstDiff.join(', ')}` : ''}`, tally.differ, 0);
    ok(`the set-ups take each rule's road — plate follows its arm ${tally.plateFollows}, the arm is a return ${tally.returnArm}, a return follows its pole ${tally.followsRod}, a brass twin ${tally.twin}, paint-to-match ${tally.match}, a stock colour ${tally.stock}, wood left bare ${tally.bare}, a collar ${tally.collar}, textures ${tally.textures}, a finish stopped at the gate ${tally.gated}, an exception by part ${tally.byPart}`,
        tally.plateFollows > 5 && tally.returnArm > 0 && tally.followsRod > 5 && tally.twin > 5 && tally.match > 5 && tally.stock > 5 && tally.bare > 5 && tally.collar > 5 && tally.textures > 50 && tally.gated > 5 && tally.byPart > 5);
    if (process.env.HS_VERBOSE) console.log('finishes —', JSON.stringify(tally));
    // a line saved before there was one default per material carries ONE code
    const ixF = finishIndexOf(FIN);
    const oldRed = oldFinish({ finishes: FIN, flowFinishes: [], findPart: () => null, model: { choices: [], slots: [] }, resolved: { choices: [], riders: [], companions: [], slots: [] }, livePicks: {}, extras: [], globalFinishes: {}, partFinish: {} }).setGlobalFinish;
    eq('a single saved code lands where the screen\'s setter put it — every code, onto every state', [{}, { METAL: 'P14' }, { WOOD: 'S04', METAL: 'EP4' }].flatMap(prev => ['', ...CODES, 'p14', 'antique pewter'].map(code => JSON.stringify(withGlobalFinish(prev, code, ixF)) === JSON.stringify(oldRed(prev, code)))).every(Boolean), true);
}

// ── THE WHOLE CALL: what a caller that is not a screen gets ───────────────────────────────────────────────
{
    let compared = 0, differ = 0;
    framings.forEach((answers, fi) => {
        const picks = picksFor(answers, `whole|${fi}`);
        for (const [ans, pk] of [[answers, picks], [framings[(fi + 1) % framings.length], picks]]) {
            const s = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [], flow: null }, { answers: ans, picks: pk });
            const model = oldModel({ choices, effAnswers: ans, picks: pk, modelNodes });
            const auto = autoPicksOf({ model, answers: ans, operatorPicks: reseatPicks(model, pk) });
            compared++;
            if (canon(s.model) !== canon(model) || canon(s.livePicks) !== canon(auto.livePicks) || canon([...s.settledKeys].sort()) !== canon([...auto.settledKeys].sort()) || canon(s.choices) !== canon(choices)) differ++;
        }
    });
    eq(`sessionOf: the one call gives what the screen's memos give, in order (${compared} compared)`, differ, 0);
    const sized = sessionOf({ assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow: SIZE_FLOW }, { answers: { proj: 3.625 }, picks: {}, sizePick: { 'SIZE-DIA': 'SIZE-DIA-138', 'SIZE-PROJ': 'SIZE-PROJ-6' } });
    eq('sessionOf sizes the choices and lets the matrix answer the projection', [sized.sizeSel.dia, sized.effAnswers.proj, sized.choices.find(c => c.role === 'ROD').partId, sized.ourId(sized.choices.find(c => c.role === 'ROD').partId)], ['138', 6, 'ID-H2-138R', 'H2-138R']);
    const withLength = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [] }, { answers: framings[0], picks: picksFor(framings[0], 'len'), lengthInches: 96.3, stepQty: {}, fabricId: 'BLACKOUT' });
    eq('sessionOf reads a saved length the way Edit restores it — 96.3" is 96 5/16", nine feet billed', [withLength.lengthInches, withLength.lengthFeet, withLength.lengthFeetExact], [96.3125, 9, 8.03]);
    ok('…and the counts are on the resolved configuration', Object.keys(withLength.quantities).length > 0 && canon(withLength.resolved) === canon(resolvedOf({ choices: withLength.choices, answers: withLength.effAnswers, livePicks: withLength.livePicks, modelNodes: withLength.modelNodes, quantities: withLength.quantities })));
    const jn = { id: 'CE-INV-900', itemId: 'CE-INV-900', legacyErpId: 'H1-2JNR', itemName: 'Joiner 2"' };
    const long = (state) => sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [jn], flow: { spliceOverInches: 96 }, extraItems: [{ code: 'H1-2JNR', label: 'Joiner' }] }, { answers: framings[0], picks: picksFor(framings[0], 'len'), ...state });
    eq('sessionOf adds the joiner a long pole needs, as the length step does', [long({ lengthInches: 144 }).extras.map(x => `${x.code}×${x.qty}`), long({ lengthInches: 144 }).spliceSatisfied], [['H1-2JNR×1'], true]);
    eq('…not under the limit, not when declined, and a saved row under the record id is the same joiner (never a second)', [long({ lengthInches: 96 }).extras.length, long({ lengthInches: 144, spliceWaived: true }).extras.length, long({ lengthInches: 144, extras: [{ code: 'CE-INV-900', qty: '2', note: 'at 5 ft' }] }).extras.map(x => `${x.code}×${x.qty}`)], [0, 0, ['H1-2JNR×2']]);
    const wornBy = (state) => { const x = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts: [], finishes: FIN, flowFinishes: ['P14', 'S04'], customerId: 'FABRICUT' }, { answers: framings[0], picks: picksFor(framings[0], 'len'), ...state });
        return [x.globalFinishes, x.globalFinish, x.offeredFinishes.map(f => f.code), x.chosenList.length > 0, x.chosenList.filter(c => x.lineFinishFor(c)).length > 0, x.clientFinishName(FIN[0])]; };
    eq('sessionOf reads the saved finish defaults as Edit restores them — one per material', wornBy({ globalFinishes: { METAL: 'P14', WOOD: 'S04' } }), [{ METAL: 'P14', WOOD: 'S04' }, 'P14', ['P14', 'S04'], true, true, 'Black']);
    eq('…or the ONE code of an older line, landed in its material\'s slot; and none at all', [wornBy({ globalFinish: 's04' }).slice(0, 2), wornBy({}).slice(0, 2), wornBy({ globalFinishes: { METAL: 'EP4' }, globalFinish: 'S04' }).slice(0, 2)], [[{ WOOD: 'S04' }, 'S04'], [{}, ''], [{ METAL: 'EP4' }, 'EP4']]);
    const empty = sessionOf();
    ok('called with nothing it answers with nothing, not a crash', Array.isArray(empty.choices) && empty.choices.length === 0 && Object.keys(empty.livePicks).length === 0);
}

// ── IT IS PART OF THE ENGINE: copied to the portal's server, held to the engine's one import rule ─────────────
{
    const { files, problems } = engineClosure();
    eq('the session is one of the engine\'s doors', ENGINE_DOORS['hardwareSession.js'], 'sessionOf');
    ok('…reached, and breaking no rule (pure: only the files beside it, with their .js)', files.has('hardwareSession.js') && problems.length === 0);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
