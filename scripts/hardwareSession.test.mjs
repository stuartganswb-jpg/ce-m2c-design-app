// Shared/hardwareSession — the configuration without the screen (PORTAL, 2026-10-12).
//   node scripts/hardwareSession.test.mjs
//
// Two halves, the way hardwareAutoPicks.test.mjs is built. The RULES: what each piece must do. The MOVE: the CPQ
// screen's inline code as it stood before it moved to Shared/hardwareSession is kept below, verbatim, and must agree
// with the module on every set-up — of the live H1-2TRV pins, and of a small assembly that asks the rod diameter
// first — the proof that moving it changed nothing the CPQ screen does.
//
// SESSION_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { resolve, reseatPicks, recommendedQty, bearingEnds, centreBracketsFor, finishesFor, ROD_ROLES, TRAVERSE } from '../src/components/Shared/hardwareModel.js';
import { choicesFromAssembly, modelNodesOf } from '../src/components/Shared/hardwareAdapter.js';
import { autoPicksOf } from '../src/components/Shared/hardwareAutoPicks.js';
import { bracketAdviceFor, DEFAULT_DROP_FT } from '../src/components/Shared/bracketSpan.js';
import { carrierRows, configuratorLines, configuratorTotal, defaultPicks } from '../src/components/Shared/traverseConfigurator.js';
import { usageAt, explodeTraverse } from '../src/components/Shared/traverseExplode.js';
import { rodMaterialsOf, extrasForRod, liveExtrasOf, noSpliceOf, noSpliceNote } from '../src/components/Shared/flowExtras.js';
import { normalizeExtras } from '../src/components/Shared/extrasRestore.js';
import { settleVision } from '../src/components/Shared/visionEngine.js';
import { wearsAsTwin } from '../src/components/Shared/materialTwin.js';
import { subFinishOfFinish } from '../src/components/Shared/subFinish.js';
import { priceConfiguration, priceChoice, pricingWarnings } from '../src/components/Shared/hardwarePricing.js';
import { customerPriceLevel } from '../src/components/Shared/priceLevels.js';
import { findClientPriceRow, customerKeys } from '../src/components/Shared/clientPricing.js';
import { applyKitPricing } from '../src/components/Shared/kitSeed.js';
import { kitForMount, motorCodeFor, parseKitCode } from '../src/components/Shared/kitCode.js';
import { takesNoFinish, finishLabelOf } from '../src/components/Shared/finishLabel.js';
import { questionsOf, unansweredOf } from '../src/components/Shared/finishQuestions.js';
import { handoffItem } from '../src/components/Shared/hardwareHandoff.js';
import { shopNotesOf, clientNotesOf } from '../src/components/Shared/lineShopNotes.js';
import { droppedPicks, mergeDrops, unacknowledged } from '../src/components/Shared/pickDrops.js';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, projInchesOfSel, buildSizeSteps } from '../src/components/Shared/sizeMatrix.js';
import { ENGINE_DOORS, engineClosure } from './sync-engine.mjs';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const S = await import(process.env.SESSION_MODULE || new URL('../src/components/Shared/hardwareSession.js', import.meta.url).href);
const { partIndexOf, partIn, ourNumberOf, sizeStepsOf, sizeSelOf, sizeIndexOf, choicesAtSize, sizeProjInchesOf, answersAtSize, settle, sessionOf,
    lengthInchesOf, lengthFeetExactOf, lengthFeetOf, lengthFieldsOf, bracketAdviceOf, recommendedFor, quantitiesOf, resolvedOf,
    spliceCodesAmong, singleSpliceOf, spliceLimitOf, spliceIsNeeded, sameItem, spliceIsSatisfied, withRequiredSplice, withoutAutoSplice, joinersNeededOf, rodRunsOf,
    globalFinishOf, finishIndexOf, materialOfFinish, withGlobalFinish, wearsAsTwinFinish, wearsFinishOf, globalFinishForChoice, chosenListOf, partFinishByPartOf,
    armFinishOfChoice, finishForChoice, matchFinishOverrideOf, isFeeRecord, rodFinishForChoice, followsRodChoice, subFinishForChoice, lineFinishForChoice,
    textureOverridesOf, chosenFinishObjectsOf, bareWoodOf, clientFinishNameOf, offeredFinishesOf, finishGroupsOf, finishGroupLabel, finishRulesOf,
    driveOf, priceCtxOf, kitFromSaved, kitBillOf, carriersFromStepOf, pricingCtxOf, pricedOf, priceWarningsOf, askingFinishesOf, liveFinishAnswersOf, openFinishQuestionsOf,
    kitPartsByLineOf, extraLinesOf, isTraverseOf, trvFeetOf, trvTracksOf, trvPriceOfCode, trvItemInfoOf, trvSeedOf, trvComponentsOf, trvLinesOf, spliceOnLineOf, shipsInOnePieceOf,
    grandTotalOf, billOf,
    AXIS_LABEL, valueLabel, slotLabel, visibleOverridesOf, clearListOf, railNamesOf, stretchSpecOf, spliceMarksOf, cloneSpecsOf, chosenPartsOf, renderStateOf,
    stepsOf, stepHintOf, extrasOnStepOf, stepAnswerOf, configQtyOf, dropRefusalOf, addRefusalOf, takenExtraLinesOf, cartLineOf, pickPartsOf, everyChoiceOf } = S;

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

// The price block, as the screen held it (HardwareConfigurator.js @ cf3db903) — the level in force, the price context,
// the kit, the priced lines, what a finish asks, what was added by hand, the traverse components, the total: every
// memo and callback in its order, closed over the same things.
const oldBill = ({ customer, customerId, priceLevel, outsourceCodes, flow, kits, trvRules, findPart, model, resolved, livePicks, extras, lengthFeet, lengthInches,
    spliceCodes, spliceOverIn, sameItemCode, finishByCode, globalFinish, lineFinishFor, subFinishFor, matchFinishOverride, answers, kitSource, kitMotor, trvSel, finishAnswers }) => {
    const { level: effectiveLevel, isDefault: levelIsDefault } = customerPriceLevel(customer, priceLevel);
    const priceCtx = ({
        customerId, customer, priceLevel: effectiveLevel, outsourceCodes,
        levelIsDefault,
        finishCode: globalFinish, finishFor: lineFinishFor, findPart, findByCode: findPart,
        subFinishFor,
        finishObjOf: (code) => finishByCode.get(String(code || '').toUpperCase()) || null,
        fallbackPrices: flow?.fallbackPrices || null,
        billedFeet: lengthFeet || 0,
        lengthInches: lengthInches || 0,
        drive: /MOTOR/.test(String(answers.drive || '').toUpperCase()) ? 'MOTORIZED' : 'MANUAL',
    });
    const kitBill = (() => {
        if (!kitSource) return null;
        const km = kitForMount(kits, kitSource.record, answers.mount);
        const moved = km.mode === 'switched' && km.kit;
        const kitRecord = moved ? km.kit : kitSource.record;
        const kitCode = moved ? String(kitRecord.legacyErpId || kitRecord.itemName || kitSource.code) : kitSource.code;
        const kitName = moved ? (kitRecord.itemName || kitCode) : kitSource.name;
        const kp = priceChoice({ partId: kitCode }, kitRecord, priceCtx);
        const kitRow = findClientPriceRow(kitRecord?.clientPricing, customerKeys(customerId, customer));
        const ms = kitRecord?.manufacturingSpecs || {};
        const family = ms.kitFamily || (parseKitCode(kitCode) || {}).family || 'H1-2TRV';
        const motorCodes = Array.isArray(ms.kitMotorCodes) ? ms.kitMotorCodes : [];
        const driveNow = /MOTOR/.test(String(answers.drive || '').toUpperCase()) ? 'MOTORIZED' : 'MANUAL';
        const motorPick = moved ? motorCodeFor(kitSource.record, kitRecord, kitMotor) : kitMotor;
        const mc = driveNow === 'MOTORIZED' && motorPick ? motorCodes.find(x => String(x.code || '').toUpperCase() === String(motorPick).toUpperCase()) : null;
        const feet = lengthFeet || kitSource.baseFeet;
        const exploded = ms.kitAlign
            ? explodeTraverse({ family, align: { ...(km.mode === 'followed' ? km.align : ms.kitAlign), drive: driveNow }, feet, motorItem: mc?.motorItem || '', rules: trvRules, proj: answers.proj != null ? String(answers.proj) : '' })
            : { lines: [] };
        const billedFeet = Math.max(Number(feet) || 0, Number(kitSource.baseFeet) || 4);
        const carrierCover = carrierRows(trvRules).map(u => ({ code: String(u.itemId || '').trim().toUpperCase(), partId: findPart(u.itemId)?.id, qty: usageAt(u, billedFeet) }));
        const included = [
            ...carrierCover,
            ...exploded.lines.map(l => ({ code: l.code, partId: findPart(l.code)?.id, qty: l.qty })),
            ...(Array.isArray(ms.kitComponents) ? ms.kitComponents : []).map(c => ({ partId: c.partId, code: findPart(c.partId)?.legacyErpId || '', qty: Number(c.qty) || 1 })),
        ];
        return {
            kitCode, kitName, kitPrice: kp?.price || 0,
            baseFeet: kitSource.baseFeet,
            mountFollow: km.mode === 'same' ? null : { mode: km.mode, mount: String(answers.mount || '').toUpperCase(), from: kitSource.code, to: kitCode, theirs: (mc && mc.fabSku) || kp?.sku || kp?.aliasCode || '' },
            perFootPrice: kitRow?.perFootPrice,
            clientSku: kp?.sku || kp?.aliasCode || '',
            included,
            motor: mc ? { code: mc.code, fabSku: mc.fabSku || '', motorItem: mc.motorItem || '', net: parseFloat(mc.net) } : null,
        };
    })();
    const carriersFromStep = !!(trvSel && trvSel.carrierStyle);
    const pricingCtx = (carriersFromStep ? { ...priceCtx, skipRoles: ['CARRIER'] } : priceCtx);
    const priced = (() => {
        const p = priceConfiguration(resolved, pricingCtx);
        return kitBill ? applyKitPricing(p, kitBill) : p;
    })();
    const priceWarnings = pricingWarnings({ lines: priced.lines.filter(l => !l.hidden) });
    const askingFinishes = (() => {
        const worn = new Set(priced.lines.map(l => String(l.finishCode || '').toUpperCase()).filter(Boolean));
        return [...worn].map(c => finishByCode.get(c)).filter(f => f && questionsOf(f).length)
            .map(f => ({ finish: f, code: String(f.code || f.name || '').toUpperCase(), questions: questionsOf(f) }));
    })();
    const liveFinishAnswers = (() => {
        const out = {};
        askingFinishes.forEach(a => { if (finishAnswers[a.code]) out[a.code] = finishAnswers[a.code]; });
        return out;
    })();
    const kitPartsByLine = (() => {
        const m = new Map();
        let cur = null;
        (priced.lines || []).forEach(l => {
            if (l.isKit && l.itemKit) { cur = l; m.set(l, []); return; }
            if (cur && l.inKit && l.hidden && l.kitOf === (cur.billedId || '')) { m.get(cur).push(l); return; }
            cur = null;
        });
        return m;
    })();
    const extraLines = extras.filter(x => x.code).map(x => {
        const part = findPart(x.code);
        const qty = Number(x.qty) > 0 ? Number(x.qty) : 1;
        const matched = x.slot ? matchFinishOverride[livePicks[x.slot]] : '';
        const unfinished = takesNoFinish(part);
        const p = priceChoice({ partId: x.code }, part, unfinished ? { ...priceCtx, finishCode: '' } : (matched ? { ...priceCtx, finishCode: matched } : priceCtx));
        return { partId: x.code, name: part?.itemName || x.code, qty, unit: p.price, total: p.price * qty,
                 sku: p.sku || p.aliasCode, source: p.source, detail: p.detail, note: x.note, extra: true,
                 ...(x.slot ? { slot: x.slot } : {}),
                 finishCode: unfinished ? '' : (matched || globalFinish), noFinish: unfinished };
    });
    const isTraverse = (() => {
        const ids = new Set(Object.values(livePicks));
        return model.choices.some(c => ids.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind === TRAVERSE);
    })();
    const trvDrive = /MOTOR/.test(String(answers.drive || '').toUpperCase()) ? 'MOTORIZED' : 'MANUAL';
    const trvFeet = Math.max(lengthFeet || 4, 4);
    const trvTracks = String(answers.setup || '').toUpperCase() === 'DOUBLE' ? 2 : 1;
    const trvPriceOf = (code) => {
        const part = findPart(code);
        return part ? (priceChoice({ partId: code }, part, priceCtx).price || 0) : 0;
    };
    const trvItemInfo = (code) => {
        const part = findPart(code);
        if (!part) return null;
        const p = priceChoice({ partId: code }, part, priceCtx);
        return { name: part.itemName || code, sku: p.sku || p.aliasCode || '' };
    };
    const trvSeed = (trvRules && isTraverse
        ? { carrierStyle: '', carrierQty: '', draw: '', motorSide: '', picks: defaultPicks({ rules: trvRules, drive: trvDrive, feet: trvFeet, trackCount: trvTracks }), accessories: {} }
        : null);
    const trvLive = trvSel || trvSeed;
    const trvComponents = ((trvRules && isTraverse && trvLive)
        ? configuratorLines({ rules: trvRules, drive: trvDrive, feet: trvFeet, realFeet: lengthFeet || undefined, sel: trvLive, priceOf: trvPriceOf })
        : []);
    const trvLines = trvComponents.map(c => ({
        partId: c.code, name: c.why || c.code, qty: c.qty,
        unit: c.billable ? c.rate : 0, total: c.billable ? c.rate * c.qty : 0,
        source: 'traverse components', detail: c.billable ? c.why : `included — ${c.why}`, extra: true,
    }));
    const spliceOnLine = extras.filter(x => spliceCodes.some(c => sameItemCode(x.code, c))).reduce((n, x) => n + (Number(x.qty) > 0 ? Number(x.qty) : 0), 0)
        + trvComponents.filter(c => /SPLICE|JOINER|JNR|SPLC/i.test(String(c.code || ''))).reduce((n, c) => n + (Number(c.qty) > 0 ? Number(c.qty) : 0), 0);
    const noSplice = noSpliceOf({ lengthInches, limitInches: spliceOverIn, canSplice: spliceCodes.length > 0 || (isTraverse && !!trvRules), spliceQty: spliceOnLine });
    const grandTotal = priced.total + extraLines.reduce((s2, l) => s2 + l.total, 0) + configuratorTotal(trvComponents);
    // (in addConfiguration) the finish questions still open
    const openQuestions = askingFinishes.map(a => [a, unansweredOf(a.finish, finishAnswers[a.code])]).filter(([, m]) => m.length);
    return { effectiveLevel, levelIsDefault, priceCtx, kitBill, carriersFromStep, pricingCtx, priced, priceWarnings, askingFinishes, liveFinishAnswers, kitPartsByLine, extraLines,
        isTraverse, trvDrive, trvFeet, trvTracks, trvPriceOf, trvItemInfo, trvSeed, trvLive, trvComponents, trvLines, spliceOnLine, noSplice, grandTotal, openQuestions };
};
// The kit a reopened line names, as the screen's restore effect decided it (the kit list loaded): what it set.
const oldKitRestore = (kits, s) => {
    const want = String(s.kitPick || '').trim();
    const wantCode = String(s.kitCode || '').trim().toUpperCase();
    if (!want && !wantCode) return { kitPick: '', kitMotor: '', kitSource: null, report: null };
    const idOf = (k) => String(k.id || k.legacyErpId || '');
    const chosen = kits.find(k => want && idOf(k) === want)
        || kits.find(k => wantCode && String(k.legacyErpId || '').trim().toUpperCase() === wantCode);
    if (!chosen || !chosen.manufacturingSpecs?.kitAlign) return { kitPick: '', kitMotor: '', kitSource: null, report: wantCode || want };
    const name = String(chosen.legacyErpId || chosen.itemName || 'the kit');
    return { kitPick: idOf(chosen), kitMotor: String(s.kitMotor || ''), kitSource: { code: name, name: chosen.itemName || name, baseFeet: Number(chosen.manufacturingSpecs.kitAlign.minFeet) || 4, record: chosen }, report: null };
};

// ── move 6: the screen's code AS IT WAS (main d135ef99, HardwareConfigurator.js) — the words on the rail, what is drawn, the walk,
//    the answer under each heading, the refusals at Add and the cart line. Lifted by script: hooks unwrapped, comments left behind
//    (the words moved to the module with the code); the two calls it already made into the module (moves 4 and 5) are answered
//    by the old blocks above, and the picture / Display-mode board — the screen's own, which stay there — are absent. ──
const OLD_AXIS_LABEL = { rodKind: 'Rod Type', setup: 'Single or Double', drive: 'Drive', mount: 'Mount', proj: 'Bracket Projection', frontLayer: 'Front of the Double' };
const oldValueLabel = (axis, v) => {
    if (axis === 'proj') {
        const n = Number(v);
        const known = { 0.75: '.75"', 3.625: '3-5/8"', 4.625: '4-5/8"', 6: '6"' };
        return known[n] || `${n}"`;
    }
    if (axis === 'frontLayer') return v === 'FASCIA' ? 'Stationary fascia with rings (one track)' : 'Traverse track front & rear';
    return String(v).charAt(0) + String(v).slice(1).toLowerCase();
};
const oldSlotLabel = (s) => {
    const kind = s.kind === 'END' ? 'End Treatment' : s.kind.charAt(0) + s.kind.slice(1).toLowerCase().replace('_', ' ');
    const cap = (w) => `${w.charAt(0)}${w.slice(1).toLowerCase()}`;
    const parts = [(s.tier && !s.tierSolo) ? cap(s.tier) : '', s.position ? cap(s.position) : '', kind].filter(Boolean);
    return parts.join(' ');
};
// ⚠ DELIBERATE RULE CHANGE, 2026-10-20 (Stuart, found-not-fixed item 6): the pencil lines are as many as the pole has SPLICES — the count
// its brackets are placed by (the session's `splice`, spliceInfoOf) — never one per joiner (a double rod's two joiners drew two lines on each
// rod). The screen's code below (oldWalk / oldAdd) is handed these lines; everything else it draws and adds is still its own.
const newMarksOf = (splice, drawnSplices, lengthInches) => {
    const c = Number(splice && splice.count) || 0;
    if (!c) return [];
    const L = Number(lengthInches) || 0;
    const at = splice.drawn ? drawnSplices.filter(sp => sp && sp.distInches != null && L > 0)
        .map(sp => (String(sp.ref).toUpperCase() === 'END' ? 1 - Number(sp.distInches) / L : Number(sp.distInches) / L))
        .filter(f => Number.isFinite(f)).map(f => Math.min(0.98, Math.max(0.02, f))) : [];
    return at.length ? at.map(frac => ({ frac })) : Array.from({ length: c }, (_, i) => ({ frac: (i + 1) / (c + 1) }));
};
const oldWalk = ({ model, settledKeys, isTraverse, trvRules, sizeSteps, sizeProjInches, answers, livePicks, lengthFeet, lengthInches, ourId, trvLive, trvComponents, sizePick,
    offeredExtraItems, resolved, extras, spliceCodes, drawnSplices, quantities }) => {
    const visibleOverrides = (() => {
        const o = {};
        resolved.visible.forEach(n => { o[String(n).toLowerCase()] = true; });
        return o;
    })();
    const clearList = (() => [...resolved.clear].map(n => String(n).toLowerCase()))();
    const railNames = (() => {
        const shown = new Set([...resolved.visible].map(n => String(n).toLowerCase()));
        return [...new Set((model.choices || [])
            .filter(c => ROD_ROLES.includes(c.role) || c.role === 'FCLIP')
            .flatMap(c => c.nodes || [])
            .filter(n => shown.has(String(n).toLowerCase())))];
    })();
    const stretchSpec = (() => (lengthInches > 0 && railNames.length ? { railNames, lengthInches } : null))();
    const spliceMarks = (() => {
        const count = extras.filter(x => spliceCodes.includes(x.code)).reduce((n, x) => n + (Number(x.qty) > 0 ? Number(x.qty) : 0), 0);
        if (!count) return [];
        const L = Number(lengthInches) || 0;
        const drawn = drawnSplices.filter(sp => sp && sp.distInches != null && L > 0)
            .map(sp => (String(sp.ref).toUpperCase() === 'END' ? 1 - Number(sp.distInches) / L : Number(sp.distInches) / L))
            .filter(f => Number.isFinite(f)).map(f => Math.min(0.98, Math.max(0.02, f)));
        if (drawn.length) return drawn.map(frac => ({ frac }));
        return Array.from({ length: count }, (_, i) => ({ frac: (i + 1) / (count + 1) }));
    })();
    const cloneSpecs = (() => {
        const pickOf = (sl) => { const id = livePicks[sl.key]; return id ? (sl.options || []).find(x => x.id === id) || null : null; };
        const out = [];
        resolved.slots.forEach(sl => {
            if (sl.kind !== 'BRACKET' || String(sl.position || '').toUpperCase() !== 'CENTER') return;
            const o = pickOf(sl);
            if (!o || !(o.nodes || []).length) return;
            const plateSlot = resolved.slots.find(x => x.kind === 'BACKPLATE' && String(x.position || '').toUpperCase() === 'CENTER');
            const plate = plateSlot ? pickOf(plateSlot) : null;
            const count = Number(quantities[o.id]) || 1;
            out.push({ stepId: sl.key, meshNames: [...o.nodes, ...((plate && plate.nodes) || [])], anchorNames: [...o.nodes], railNames, count });
        });
        return out;
    })();
    const chosen = (() => {
        const ids = new Set(Object.values(livePicks));
        return [...model.choices.filter(c => ids.has(c.id)), ...model.riders];
    })();
    const steps = (() => {
        const out = [];
        sizeSteps.forEach(st => out.push({ kind: 'SIZE', key: `size:${st.id}`, sizeStep: st, label: st.title }));
        const liveAxes = model.axes.filter(a => !a.implied && a.values.length > 1)
            .filter(a => !(a.key === 'proj' && sizeProjInches != null));
        const framing = liveAxes.filter(a => a.key !== 'proj');
        if (framing.length === 1) {
            const a = framing[0];
            out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: OLD_AXIS_LABEL[a.key] || a.key });
        } else if (framing.length) {
            out.push({ kind: 'AXES', key: 'axes:framing', axes: framing, label: 'Rod Setup' });
        }
        liveAxes.filter(a => a.key === 'proj')
            .forEach(a => out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: OLD_AXIS_LABEL[a.key] || a.key }));
        const plates = model.slots.filter(s => s.kind === 'BACKPLATE');
        const nested = new Set();
        model.slots.filter(s => s.kind !== 'BACKPLATE').forEach(s => {
            if (!s.options.length && !s.suppressedBy) return;
            if (settledKeys.has(s.key)) return;      // answered by the drive — see settledKeys
            if (s.kind === 'TRV_END') return;
            const plateHere = () => plates.find(p => (p.position || '') === (s.position || ''));
            let sub = null;
            if (s.kind === 'BRACKET' && !s.suppressedBy) sub = plateHere();
            else if (s.kind === 'END' && s.position) {
                const bkt = model.slots.find(x => x.kind === 'BRACKET' && (x.position || '') === (s.position || ''));
                if (!bkt || bkt.suppressedBy) sub = plateHere();
            }
            if (sub && nested.has(sub.key)) sub = null;
            if (sub) nested.add(sub.key);
            out.push({ kind: 'SLOT', key: s.key, slot: s, sub, label: oldSlotLabel(s) });
        });
        plates.filter(p => !nested.has(p.key) && p.options.length)
            .forEach(p => out.push({ kind: 'SLOT', key: p.key, slot: p, label: oldSlotLabel(p) }));
        const lengthStep = { kind: 'LENGTH', key: 'length', label: 'Pole length' };
        let lastRod = -1, lastAxis = -1;
        out.forEach((st, i) => {
            if (st.kind === 'SLOT' && ROD_ROLES.includes(st.slot.kind)) lastRod = i;
            if (st.kind === 'AXIS') lastAxis = i;
        });
        if (lastRod >= 0) out.splice(lastRod + 1, 0, lengthStep);
        else if (lastAxis >= 0) out.splice(lastAxis + 1, 0, lengthStep);
        else out.push(lengthStep);
        const ringSlot = out.find(st => st.kind === 'SLOT' && st.slot.kind === 'RING');
        const carriers = (model.riders || []).filter(r => r.role === 'CARRIER');
        if (!ringSlot && carriers.length) out.push({ kind: 'CARRIERS', key: 'carriers', label: 'Carriers', carriers });

        if (isTraverse && trvRules) out.push({ kind: 'TRV', key: 'traverse', label: 'Traverse components' });
        return out;
    })();
    const hintFor = ((st) => {
        if (!st || st.kind !== 'SLOT') return '';
        if (st.slot.kind === 'TRACK') return 'Chosen by the layout at Rod Setup. Comes in bronze or champagne to coordinate with the fascia — add the custom-finish upcharge to paint it to match.';
        return '';
    });
    const extrasOnStep = (st) => (offeredExtraItems || []).filter(it => {
        const m = String(it.step || '').trim().toUpperCase();
        if (!m) return st?.kind === 'LENGTH';
        if (st?.kind === 'LENGTH' && /LENGTH|POLE/.test(m)) return true;
        const label = String(st?.label || '').toUpperCase();
        return !!label && (label.includes(m) || m.includes(label));
    });
    const answerOf = ((st) => {
        if (st.kind === 'AXIS') { const v = answers[st.axis.key]; return v == null || v === '' ? '' : oldValueLabel(st.axis.key, v); }
        if (st.kind === 'AXES') {
            return st.axes.map(a => {
                const v = answers[a.key];
                return v == null || v === '' ? '' : oldValueLabel(a.key, v);
            }).filter(Boolean).join(' \u00b7 ');
        }
        if (st.kind === 'SIZE') {
            const opt = (st.sizeStep.styleOptions || []).find(o => o.optId === sizePick[st.sizeStep.id]);
            return opt ? (opt.partName || opt.label || opt.optId) : '';
        }
        if (st.kind === 'CARRIERS') {
            const n = st.carriers.reduce((sum, c) => sum + (recommendedQty(c, lengthFeet) || c.qty || 1), 0);
            return n ? `${n} included` : 'included';
        }
        if (st.kind === 'LENGTH') return lengthFeet ? `${lengthFeet} ft` : '';
        if (st.kind === 'TRV') {
            if (!trvLive?.carrierStyle) return '';
            const style = (trvRules?.usage || []).find(u => String(u.itemId || '').toUpperCase() === trvLive.carrierStyle);
            return `${style?.label || trvLive.carrierStyle} · ${trvComponents.length}`;
        }
        if (st.slot.suppressedBy) return 'not asked';
        const pick = st.slot.options.find(o => o.id === livePicks[st.slot.key]);
        return pick ? (ourId(pick.partId) || pick.name) : '';   // our number on the rail too
    });
    return { visibleOverrides, clearList, railNames, stretchSpec, spliceMarks, cloneSpecs, chosen, steps, hintFor, extrasOnStep, answerOf };
};
const oldAdd = ({ priced, pendingDrops, oldBareWood, oldOpenQuestions, resolved, pricingCtx, assembly, flow, findPart, cfgQty, pins, configMemo, chosenFinishObjects, effectiveLevel, lengthInches, lengthFeet,
    extras, extraLines, stepNotes, stepNoteClient, answers, livePicks, partFinish, globalFinish, globalFinishes, stepQty, liveFinishAnswers, kitBill, kitSource, kitPick, kitMotor, isTraverse, trvSel, trvComponents, trvLive,
    cadUrl, textureOverrides, visibleOverrides, cloneSpecs, stretchSpec, spliceMarks, clearList, steps, noSplice, spliceOverIn }) => {
    const said = []; const alert = (m) => { said.push(m); };
    let added = null; const onAdd = (it) => { added = it; };
    const cfgQtyN = Math.max(1, parseInt(cfgQty, 10) || 1);
    const dropRefusal = pendingDrops.length
        ? `${pendingDrops.length} selection${pendingDrops.length === 1 ? ' was' : 's were'} removed by a later choice — read the strip under the rail and press Understood on each before adding.`
        : '';
    const addConfiguration = () => {
        if (!priced.lines.length) return;
        if (pendingDrops.length) return;
        const bareWood = oldBareWood;
        if (bareWood.length) {
            alert(`Pick the WOOD finish first — ${bareWood.map(c => c.name || c.partId).join(', ')} would leave here with no stain.\n\nChoose it on the WOOD row of the finish step, or on the part itself.`);
            return;
        }
        const openQuestions = oldOpenQuestions;
        if (openQuestions.length) {
            alert(`Answer the finish questions first — ${openQuestions.map(([a, m]) => `${a.code}${a.finish.name ? ` (${String(a.finish.name).trim()})` : ''}: ${m.join(', ')}`).join(' · ')}.\n\nThey are at the top of the finish panel and apply to the whole configuration.`);
            return;
        }
        const renderSnapshot = null;
        const displaySnapshot = null;
        const displayBoard = null;
        const built = handoffItem(resolved, {
            ...pricingCtx, assembly, flow, findPart, qty: cfgQtyN, renderSnapshot,
            pins,
            sidemark: configMemo, memo: configMemo,
            finishes: chosenFinishObjects, finishLabel: finishLabelOf(chosenFinishObjects),
            priceLevel: effectiveLevel, lengthInches, lengthFeet,
            extras, extraLines: extraLines.filter(l => Number((extras.find(x => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0),
            stepNotes, answers, picks: livePicks, partFinish, globalFinish, globalFinishes, stepQty,
            finishAnswers: liveFinishAnswers,
            kit: kitBill, kitPick: kitSource ? kitPick : '', kitMotor: kitSource ? kitMotor : '',
            trvSel: (isTraverse && trvSel) ? trvSel : null,
            trvComponents,
            traverseDraw: trvLive?.draw || '',
            traverseMotorSide: trvLive?.motorSide || '',
            renderState: cadUrl ? {
                cadUrl,
                textureEntries: Object.entries(textureOverrides || {}).map(([target, url]) => ({ target, url })),
                visibilityEntries: Object.entries(visibleOverrides || {}).map(([target, visible]) => ({ target, visible })),
                cloneSpecs,
                stretchSpec,
                spliceMarks,
                defaultHidden: true,
                clearNodes: clearList,
            } : null,
        });
        const shopNotes = shopNotesOf({ steps, stepNotes, lead: noSplice ? [noSpliceNote(lengthInches, spliceOverIn)] : [] });
        const clientNotes = clientNotesOf({ steps, stepNotes, visible: stepNoteClient });
        const ticked = Object.keys(stepNoteClient).length > 0;
        const item = (noSplice || shopNotes.length || ticked)
            ? { ...built,
                ...((noSplice || ticked) ? { engineConfig: { ...built.engineConfig, ...(noSplice ? { spliceWaived: true } : {}), ...(ticked ? { stepNoteClient: { ...stepNoteClient } } : {}) } } : {}),
                ...(shopNotes.length ? { generalNotes: shopNotes } : {}),
                ...(clientNotes.length ? { clientNotes } : {}) }
            : built;
        if (typeof onAdd === 'function') onAdd(displaySnapshot ? { ...item, displaySnapshot, displayBoard } : item);
    };
    addConfiguration();
    return { said, item: added, dropRefusal, cfgQtyN };
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
                        // The advice carries what the old one did, field for field, plus the span answers it was worked from
                        // and the column that applies (2026-10-19) — at the defaults, the stud column: the same numbers.
                        const asOld = (a) => (a && o.advice ? Object.fromEntries(Object.keys(o.advice).map(k => [k, a[k]])) : a);
                        if (canon(o.advice) !== canon(asOld(advice)) || canon(o.quantities) !== canon(quantities) || canon(o.resolved) !== canon(resolved)
                            || model.slots.some(sl => o.recommendFor(sl, sl.options[0]) !== recommendFor(sl, sl.options[0])) || o.recommendFor(null) !== recommendFor(null)) differ++;
                        if (advice && (advice.supports !== advice.brackets || advice.everyInches !== advice.spanInches || advice.whyApplies !== advice.why
                            || advice.fabricId !== fabricId || advice.dropFt !== DEFAULT_DROP_FT || advice.onStud !== true)) differ++;
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

// ── A BRACKET AT THE SPLICE, ON A TRAVERSE TOO (2026-10-19): the traverse's joiner is a tick on its components step, counted from
//    its chart — the centre count follows it as it follows a length-step joiner ──
{
    const { trvJoinersOf, spliceInfoOf } = S;
    const SPAN = { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' };
    const CHART = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 8: 32, 12: 48, 16: 64 } }, { label: 'Splice', itemId: 'H1-2TRVSPLC', byFeet: { 11: 1, 16: 1 } }],
        configurator: [{ itemId: 'H1-2TRVSPLC', drive: 'BOTH', billable: false }, { itemId: 'HTTENDSTOP', drive: 'BOTH', billable: false }] };
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    let traverse = 0, joined = 0, odd = 0, short = 0, solid = 0, roundedUp = 0, wrong = [];
    framings.forEach((answers, fi) => {
        const picks = picksFor(answers, `trv-splice|${fi}`);
        const at = (lengthInches) => sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, spanMap: SPAN, trvRules: CHART }, { answers, picks, lengthInches, onStud: false });
        const long = at(144), short8 = at(96);
        if (!long.isTraverse) { solid++; if (trvJoinersOf({ trvRules: CHART, model: long.model, livePicks: long.livePicks, answers, lengthFeet: long.lengthFeet, trvSel: null })) wrong.push(`solid #${fi} counted a traverse joiner`); return; }
        traverse++;
        const j12 = trvJoinersOf({ trvRules: CHART, model: long.model, livePicks: long.livePicks, answers, lengthFeet: long.lengthFeet, trvSel: null });
        const j8 = trvJoinersOf({ trvRules: CHART, model: short8.model, livePicks: short8.livePicks, answers, lengthFeet: short8.lengthFeet, trvSel: null });
        if (j12 !== 1 || j8 !== 0) wrong.push(`#${fi}: joiners at 12 ft ${j12}, at 8 ft ${j8}`);
        if (long.splice.count === 1 && short8.splice.count === 0) joined++; else wrong.push(`#${fi}: splice ${long.splice.count} / ${short8.splice.count}`);
        const centre = long.model.slots.find(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && long.livePicks[sl.key]);
        if (centre) { const q = long.quantities[long.livePicks[centre.key]]; if (q % 2 === 1) odd++; else wrong.push(`#${fi}: a spliced traverse with ${q} centre brackets`); }
        // 126" on drywall toggles: the span alone wants 2 in the centre (4 supports at 42") — the splice makes it 3
        const mid = at(126);
        const centreMid = mid.model.slots.find(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && mid.livePicks[sl.key]);
        if (centreMid && mid.advice && mid.splice.count === 1) { const q = mid.quantities[mid.livePicks[centreMid.key]]; if (q === 3 && mid.advice.supports === 4) roundedUp++; else wrong.push(`#${fi}: at 126" ${q} centre brackets from ${mid.advice.supports} supports`); }
        if (long.supportShort.length) short++;
    });
    eq(`the traverse's chart joiner is a splice: counted at 12 ft and not at 8, never on a solid pole; and the centre count at it is odd (traverse set-ups ${traverse}, solid ${solid})${wrong.length ? ` — ${wrong.slice(0, 3).join('; ')}` : ''}`, wrong.length, 0);
    ok(`…reached: ${traverse} traverse set-ups, ${joined} spliced at 12 ft, ${odd} odd centre counts, ${roundedUp} rounded up from an even 2 at 126"`, traverse > 5 && joined === traverse && odd > 5 && solid > 0 && roundedUp > 5);
}

// ── THE STUD ANSWER AND THE CURTAIN LENGTH, THROUGH THE WHOLE CALL, on the live H1-2TRV pins (2026-10-19) ──
{
    const SPAN = { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' };
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    let tried = 0, centred = 0, moreOffStud = 0, shortSaid = 0, differ = 0;
    framings.forEach((answers, fi) => {
        const picks = picksFor(answers, `stud|${fi}`);
        const at = (state) => sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, spanMap: SPAN }, { answers, picks, lengthInches: 180, ...state });
        const inStud = at({}), offStud = at({ onStud: false });
        if (!inStud.advice) return;
        tried++;
        const centre = inStud.model.slots.find(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && inStud.livePicks[sl.key]);
        if (!centre) return;
        centred++;
        const ends = bearingEnds(inStud.model.choices, Object.values(inStud.livePicks), inStud.model.slots);
        const id = inStud.livePicks[centre.key];
        if (inStud.quantities[id] !== centreBracketsFor(inStud.advice.supports, ends) && centreBracketsFor(inStud.advice.supports, ends) > 0) differ++;
        if (offStud.quantities[id] !== centreBracketsFor(offStud.advice.bracketsNoStud, ends) && centreBracketsFor(offStud.advice.bracketsNoStud, ends) > 0) differ++;
        if (offStud.advice.supports > inStud.advice.supports && (offStud.quantities[id] || 0) > (inStud.quantities[id] || 0)) moreOffStud++;
        const typedLow = at({ onStud: false, stepQty: { [centre.key]: '1' } });
        if (typedLow.supportShort.length === 1 && typedLow.supportShort[0].chosen === 1 && typedLow.supportShort[0].recommended === offStud.quantities[id]) shortSaid++;
        else if ((offStud.quantities[id] || 0) > 1) differ++;
        if (inStud.supportShort.length || offStud.supportShort.length) differ++;          // the recommended count is never short of itself
    });
    eq('through sessionOf: the centre count is the column that applies — into studs, or not', differ, 0);
    eq(`…reached: advice in ${tried}, a centre bracket in ${centred}, more of them off-stud in ${moreOffStud}, a short count said in ${shortSaid}`,
        [tried > 5, centred > 3, moreOffStud > 3, shortSaid > 3], [true, true, true, true]);
}

// ── A TRAVERSE THAT SELLS AS A KIT TAKES THE KIT'S BRACKETS (Stuart 2026-10-20: "the H1-2TRV should follow the kit inclusion guide
//    established in 4.6 whatever # included in the kits is the correct span needs to be aligned") — the rules, then the live pins ──
{
    const { chartGovernsBracketsOf, chartBracketsFor, kitChartBracketsOf, takesChartCount } = S;
    // rows that differ, so which row was read shows (the live chart's five rows are identical)
    const CHART = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 8: 32, 12: 48 } },
        { label: 'Brackets 3-5/8"', itemId: 'H1-2TRV-WB', byFeet: { 2: 2, 4: 2, 5: 3, 10: 4, 11: 5, 18: 7 } },
        { label: 'Brackets 4-5/8"', itemId: 'H1-2TRV-EWB', byFeet: { 2: 2, 4: 2, 5: 3, 10: 5, 11: 6, 18: 8 } },
        { label: 'Brackets 6"', itemId: 'H1-2TRV-6WB', byFeet: { 2: 2, 4: 2, 5: 4, 10: 6, 11: 7, 18: 9 } },
        { label: 'Double track brackets', itemId: 'H1-2TRV-DWB', byFeet: { 2: 2, 4: 2, 5: 3, 10: 4, 11: 5, 18: 7 } },
        { label: 'Double ring brackets', itemId: 'H1-2TRV-DRTWB', byFeet: { 2: 2, 4: 2, 5: 3, 10: 4, 11: 5, 18: 7 } }], configurator: [] };
    eq('the families the kit chart counts: H1-2TRV (as written on the flow, any case) — and only with its chart on file',
        [chartGovernsBracketsOf({ flow: { kitFamily: 'H1-2TRV' }, trvRules: CHART }), chartGovernsBracketsOf({ flow: { kitFamily: ' h1-2trv ' }, trvRules: CHART }),
         chartGovernsBracketsOf({ flow: { kitFamily: 'H1-2TRV' }, trvRules: null }), chartGovernsBracketsOf({ flow: { kitFamily: 'H1-138TRV' }, trvRules: CHART }), chartGovernsBracketsOf({ flow: null, trvRules: CHART })],
        [true, true, false, false, false]);
    const at = (code, feet, proj = '') => chartBracketsFor({ trvRules: CHART, family: 'H1-2TRV', choice: { partId: code }, ourId: (x) => x, lengthFeet: feet, proj });
    eq('a bracket\'s count is its own row at the length — by our number, the finish dropped; between entries it reads up (as the kit does)',
        [at('H1-2TRV-WB', 10), at('H1-2TRV-EWB/P09', 10), at('h1-2trv-6wb', 10), at('H1-2TRV-WB', 7), at('H1-2TRV-WB', 11), at('H1-2TRV-WB', 1)], [4, 5, 6, 4, 5, 2]);
    eq('the ceiling bracket has no row: the single\'s at the depth sold, the standard one when none was (traverseExplode\'s own fallback)',
        [at('H1-2TRV-CB', 10), at('H1-2TRV-CB', 10, '4.625'), at('H1-2TRV-CB', 10, '6'), at('H1-2TRV-CB', 10, '3.625')], [4, 5, 6, 4]);
    eq('a part that is not the family\'s and has no row, no chart, no bracket, no length — no count (6.5 counts it)',
        [at('H1-2RCTSPA', 10), chartBracketsFor({ trvRules: null, family: 'H1-2TRV', choice: { partId: 'H1-2TRV-WB' }, ourId: (x) => x, lengthFeet: 10 }), at(null, 10), chartBracketsFor({ trvRules: CHART, family: 'H1-2TRV', choice: null, ourId: (x) => x, lengthFeet: 10 }), at('H1-2TRV-WB', 0)],
        [null, null, null, null, null]);
    eq('the steps the count is spread over: the centre and a bracket step with no end position — an end keeps its own one',
        ['CENTER', '', 'LEFT', 'right'].map(position => takesChartCount({ kind: 'BRACKET', position })).concat([takesChartCount({ kind: 'RING', position: 'CENTER' }), takesChartCount(null)]),
        [true, true, false, false, false, false]);
    const flat = settle({ choices, answers: framings[0], picks: {}, modelNodes });
    eq('recommendedFor: an unpositioned bracket step takes the whole count; an end step is never handed it',
        [recommendedFor({ slot: { kind: 'BRACKET', position: '' }, choice: {}, advice: null, model: flat, livePicks: {}, lengthFeet: 10, chartCount: 4 }),
         recommendedFor({ slot: { kind: 'BRACKET', position: 'LEFT' }, choice: { role: 'BRACKET' }, advice: null, model: flat, livePicks: {}, lengthFeet: 10, chartCount: 4 })],
        [4, null]);

    // through sessionOf, on the live H1-2TRV pins
    const SPAN = { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' };
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    const FLOW = { kitFamily: 'H1-2TRV' };
    const billedBrackets = (n) => n.model.slots.filter(sl => sl.kind === 'BRACKET' && n.livePicks[sl.key])
        .reduce((t, sl) => t + (Number(((n.resolved.bom || []).find(b => b.id === n.livePicks[sl.key]) || {}).qty) || 0), 0);
    const want = (code, feet, proj) => at(code, feet, proj == null ? '' : String(proj));
    let runs = 0, ceiling = 0, solid = 0, sixFive = 0, unpickedHeld = 0; const wrong = [];
    framings.forEach((answers) => {
        const probe = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, flow: FLOW, spanMap: SPAN, trvRules: CHART }, { answers, picks: picksFor(answers, 'kit-chart'), lengthInches: 120 });
        if (!probe.isTraverse) {
            // a solid rod on the same flow keeps 6.5
            solid++;
            if (probe.chartBrackets || probe.kitChartBrackets) wrong.push(`solid ${JSON.stringify(answers)}: the chart governed`);
            if (probe.advice) sixFive++;
            return;
        }
        const slots = probe.model.slots.filter(sl => sl.kind === 'BRACKET' && !sl.suppressedBy && sl.options.length);
        const centre = slots.find(sl => String(sl.position || '').toUpperCase() === 'CENTER');
        for (const opt of (centre ? centre.options : [])) {
            const code = probe.ourId(opt.partId);
            const picks0 = { ...picksFor(answers, 'kit-chart'), ...Object.fromEntries(slots.map(sl => [sl.key, (sl.options.find(o => probe.ourId(o.partId) === code) || sl.options[0]).id])) };
            for (const inches of [48, 60, 120, 132, 216]) {
                const kit = want(code, Math.ceil(inches / 12), answers.proj);
                // (where the kit leaves the centre nothing, it is not picked — the kit start does not pick it either, kitStart.kitFillsOf)
                const picks = kit - 2 > 0 ? picks0 : Object.fromEntries(Object.entries(picks0).filter(([k]) => k !== centre.key));
                for (const state of [{}, { onStud: false }, { onStud: true, fabricId: 'BLACKOUT', dropFt: 14 }]) {
                    const n = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, flow: FLOW, spanMap: SPAN, trvRules: CHART }, { answers, picks, lengthInches: inches, ...state });
                    if (!n.isTraverse) continue;
                    runs++; if (code === 'H1-2TRV-CB') ceiling++;
                    const tag = `${code} ${inches}" ${JSON.stringify(answers)} ${JSON.stringify(state)}`;
                    if (billedBrackets(n) !== kit) wrong.push(`${tag}: billed ${billedBrackets(n)}, the kit includes ${kit}`);
                    if (!n.kitChartBrackets || n.kitChartBrackets.count !== kit || n.kitChartBrackets.feet !== Math.ceil(inches / 12)) wrong.push(`${tag}: said ${JSON.stringify(n.kitChartBrackets)}`);
                    const centreWant = Math.max(kit - 2, 0);
                    if (n.kitChartBrackets && (n.kitChartBrackets.centre !== centreWant || n.kitChartBrackets.where !== (centreWant > 0 ? `${centreWant} in the centre, the ends carry the rest` : 'the ends carry them, none in the centre'))) wrong.push(`${tag}: where ${JSON.stringify(n.kitChartBrackets)}`);
                    if (n.advice || n.rodOptions.length) wrong.push(`${tag}: 6.5's words still said`);
                    if (n.supportShort.length) wrong.push(`${tag}: short of its own count`);
                }
            }
        }
        // the centre not picked yet is held to the kit's count less the ends — the short-count note and the kit start read it
        if (centre) {
            const ends = Object.fromEntries(slots.filter(sl => sl !== centre).map(sl => [sl.key, sl.options[0].id]));
            const u = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, flow: FLOW, spanMap: SPAN, trvRules: CHART }, { answers, picks: { ...picksFor(answers, 'kit-chart'), ...ends, [centre.key]: '' }, lengthInches: 144 });
            const sh = u.isTraverse ? u.supportShort.find(x => x.slotKey === centre.key) : null;
            if (u.isTraverse && !u.livePicks[centre.key]) { if (sh && !sh.picked && sh.recommended === (u.kitChartBrackets || {}).count - 2) unpickedHeld++; else wrong.push(`unpicked centre at 12 ft: ${JSON.stringify(sh)} / ${JSON.stringify(u.kitChartBrackets)}`); }
        }
    });
    eq(`H1-2TRV traverse: the brackets billed are what the kit includes, in a stud, on drywall, under a heavy curtain; said once, never short of itself${wrong.length ? ` — ${wrong.slice(0, 3).join('; ')}` : ''}`, wrong.length, 0);
    ok(`…reached: ${runs} traverse runs (${ceiling} on the ceiling bracket), ${unpickedHeld} unpicked centres held to the kit's count, ${solid} solid framings (${sixFive} with 6.5's advice)`, runs > 100 && ceiling > 10 && unpickedHeld > 3 && solid > 0 && sixFive > 0);
    // the same pins without the family on the flow: as before — 6.5 counts the traverse too
    const before = framings.map(answers => sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, flow: null, spanMap: SPAN, trvRules: CHART }, { answers, picks: picksFor(answers, 'kit-chart'), lengthInches: 120 })).filter(n => n.isTraverse);
    eq('a flow that names no kit family keeps 6.5 on its traverses', [before.length > 0, before.every(n => !n.chartBrackets && !n.kitChartBrackets), before.some(n => n.advice)], [true, true, true]);
    eq('no length → nothing said', kitChartBracketsOf({ chartBrackets: true, trvRules: CHART, family: 'H1-2TRV', model: flat, livePicks: {}, ourId: (x) => x, lengthFeet: null }), null);
    const oneStep = { slots: [{ kind: 'BRACKET', key: 'B', position: '', options: [{ id: 'c1', partId: 'H1-2TRV-EWB' }] }], choices: [] };
    eq('one bracket step with no end position: it asks for all of them; before a pick, the single at the depth sold is read',
        [kitChartBracketsOf({ chartBrackets: true, trvRules: CHART, family: 'H1-2TRV', model: oneStep, livePicks: { B: 'c1' }, ourId: (x) => x, lengthFeet: 10 }),
         kitChartBracketsOf({ chartBrackets: true, trvRules: CHART, family: 'H1-2TRV', model: oneStep, livePicks: {}, ourId: (x) => x, lengthFeet: 10, proj: '6' })],
        [{ feet: 10, count: 5, centre: null, where: 'the bracket step asks for all of them' }, { feet: 10, count: 6, centre: null, where: 'the bracket step asks for all of them' }]);
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
    eq('none on the list → one, at 1, last — marked as the step\'s own', withRequiredSplice([{ code: 'H1-RNGX', qty: '4', note: '' }], 'H1-138JNR', same), [{ code: 'H1-RNGX', qty: '4', note: '' }, { code: 'H1-138JNR', qty: '1', note: '', auto: true }]);
    eq('taken off at 0 → put back at 1, once (its old row goes)', withRequiredSplice([{ code: 'CE-INV-900', qty: '0', note: 'x' }], 'H1-138JNR', same), [{ code: 'H1-138JNR', qty: '1', note: '', auto: true }]);
    // ── THE JOINERS A LONG POLE NEEDS (Stuart 2026-10-20: "go ahead on long pole fix"): one per rod per splice ──
    eq('the joiners a pole needs: none under the limit; past it, one per splice (pieces − 1) — per rod on a double',
        [joinersNeededOf({ lengthInches: 100, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 120, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 150, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 240, spliceOverIn: 120 }),
         joinersNeededOf({ lengthInches: 241, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 300, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 400, spliceOverIn: 120 }), joinersNeededOf({ lengthInches: 150, spliceOverIn: 120, runs: 2 }),
         joinersNeededOf({ lengthInches: 300, spliceOverIn: 120, runs: 2 }), joinersNeededOf({ lengthInches: 200, spliceOverIn: 96 }), joinersNeededOf({ lengthInches: 200 }), joinersNeededOf({})],
        [0, 0, 1, 1, 2, 2, 3, 2, 4, 2, 1, 0]);
    eq('a double is two runs; anything else one', [rodRunsOf({ setup: 'DOUBLE' }), rodRunsOf({ setup: 'double' }), rodRunsOf({ setup: 'SINGLE' }), rodRunsOf({}), rodRunsOf(null)], [2, 2, 1, 1, 1]);
    eq('a long pole\'s joiner goes on at the count it needs', withRequiredSplice([], 'H1-138JNR', same, 2), [{ code: 'H1-138JNR', qty: '2', note: '', auto: true }]);
    const autoRow = [{ code: 'H1-138JNR', qty: '1', note: '18 in from left', auto: true }];
    eq('the step\'s joiner follows the length (its note kept)', withRequiredSplice(autoRow, 'H1-138JNR', same, 3), [{ code: 'H1-138JNR', qty: '3', note: '18 in from left', auto: true }]);
    ok('…and at the count it already has, the SAME list', withRequiredSplice(autoRow, 'H1-138JNR', same, 1) === autoRow);
    const typedRow = [{ code: 'H1-138JNR', qty: '1', note: '' }];
    ok('a count the operator typed stands — the SAME list, whatever the length', withRequiredSplice(typedRow, 'H1-138JNR', same, 3) === typedRow);
    eq('back under the limit, the step\'s joiner goes — a typed one and every other row stay', [withoutAutoSplice([...autoRow, { code: 'H1-RNGX', qty: '4', note: '' }], 'H1-138JNR', same), withoutAutoSplice(typedRow, 'H1-138JNR', same)], [[{ code: 'H1-RNGX', qty: '4', note: '' }], typedRow]);
    ok('…and with none of the step\'s, the SAME list', withoutAutoSplice(typedRow, 'H1-138JNR', same) === typedRow);
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
        // ⚠ DELIBERATE RULE CHANGE, 2026-10-20 (Stuart: "go ahead on long pole fix"): the joiner goes on at the count the pole needs
        // (joinersNeededOf — the same 1 the old code added at every length tested here) and is marked `auto` (it follows the length; a
        // count typed stands). The mark is set aside for the comparison; the counts past one are checked on their own above.
        if (spliceNeeded && spliceCode && !spliceWaived) typed = withRequiredSplice(typed, spliceCode, same, joinersNeededOf({ lengthInches: L, spliceOverIn }));
        const extras = liveExtrasOf(typed, extraItems, rodMats);
        const unmark = (rows) => rows.map(({ auto, ...r }) => r);   // eslint-disable-line no-unused-vars
        const n = { spliceCodes, spliceCode, spliceOverIn, spliceNeeded, spliceSatisfied: spliceIsSatisfied(spliceCodes, extras, same), typed: unmark(typed), extras: unmark(extras) };
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

// ── THE RULES, the price: the pieces that are a rule in themselves ─────────────────────────────────────────────
{
    eq('the drive is manual unless the answer says motorised', [driveOf('Motorized'), driveOf('MOTOR'), driveOf('manual'), driveOf(''), driveOf(undefined)], ['MOTORIZED', 'MOTORIZED', 'MANUAL', 'MANUAL', 'MANUAL']);
    const ctx = priceCtxOf({ customerId: 'C1', customer: { name: 'X' }, effectiveLevel: 'FAB_COST', levelIsDefault: true, outsourceCodes: ['EP4'], globalFinish: 'P14', lineFinishFor: () => 'L', subFinishFor: () => 'S', findPart: () => 'F',
        finishByCode: finishIndexOf(FIN), flow: { fallbackPrices: { BRACKET: 11 } }, lengthFeet: 9, lengthInches: 96.5, drive: 'MOTORIZED' });
    eq('what the price rules are handed: the level in force and whether it was chosen, the one finish code, the feet billed and the inches cut, the drive, the flow\'s fallbacks',
        [ctx.priceLevel, ctx.levelIsDefault, ctx.finishCode, ctx.billedFeet, ctx.lengthInches, ctx.drive, ctx.fallbackPrices, ctx.customerId, ctx.outsourceCodes], ['FAB_COST', true, 'P14', 9, 96.5, 'MOTORIZED', { BRACKET: 11 }, 'C1', ['EP4']]);
    eq('…each line\'s own finish, the stock colour, the part finder under both its names, and the finish record behind a code (its species)', [ctx.finishFor(), ctx.subFinishFor(), ctx.findPart(), ctx.findByCode === ctx.findPart, ctx.finishObjOf('s04').bomSuffix, ctx.finishObjOf('nope')], ['L', 'S', 'F', true, 'OAK', null]);
    eq('no length, no fallbacks → none', [priceCtxOf({ finishByCode: new Map(), flow: null }).billedFeet, priceCtxOf({ finishByCode: new Map(), flow: null }).lengthInches, priceCtxOf({ finishByCode: new Map(), flow: {} }).fallbackPrices], [0, 0, null]);

    const k = (id, code, align, extra = {}) => ({ id, legacyErpId: code, itemName: `System ${code}`, manufacturingSpecs: align ? { kitAlign: align } : {}, ...extra });
    const kl = [k('K1', 'H1-2TRV-4/P', { minFeet: 4 }), k('', 'H1-2TRV-6/P', { minFeet: 6 }), k('K3', 'H1-2TRV-WB', null), k('K4', '', {}, { itemName: 'Unnumbered' })];
    eq('a line that names no kit', kitFromSaved(kl, {}), { none: true });
    eq('the kit by the id it was picked under', [kitFromSaved(kl, { kitPick: 'K1' }).kitPick, kitFromSaved(kl, { kitPick: 'K1' }).kitSource.code, kitFromSaved(kl, { kitPick: 'K1' }).kitSource.baseFeet, kitFromSaved(kl, { kitPick: 'K1' }).kitSource.record === kl[0]], ['K1', 'H1-2TRV-4/P', 4, true]);
    eq('…a kit with no id is picked under its number; an older line names its kit by the number on its own bill, whatever the case', [kitFromSaved(kl, { kitPick: 'H1-2TRV-6/P' }).kitSource.baseFeet, kitFromSaved(kl, { kitCode: ' h1-2trv-4/p ' }).kitPick, kitFromSaved(kl, { kitPick: 'GONE', kitCode: 'H1-2TRV-6/P' }).kitPick], [6, 'K1', 'H1-2TRV-6/P']);
    eq('a kit this flow no longer offers, or one that lost its alignment, is named as missing', [kitFromSaved(kl, { kitPick: 'GONE' }), kitFromSaved(kl, { kitCode: 'h1-2trv-9/p' }), kitFromSaved(kl, { kitPick: 'K3' }), kitFromSaved([], { kitPick: 'K1' })], [{ missing: 'GONE' }, { missing: 'H1-2TRV-9/P' }, { missing: 'K3' }, { missing: 'K1' }]);
    eq('its name is its number, else its description; its base feet 4 where the alignment names none', [kitFromSaved(kl, { kitPick: 'K4' }).kitSource.code, kitFromSaved(kl, { kitPick: 'K4' }).kitSource.name, kitFromSaved(kl, { kitPick: 'K4' }).kitSource.baseFeet], ['Unnumbered', 'Unnumbered', 4]);
    eq('no kit in hand → no kit on the bill', kitBillOf({ kitSource: null }), null);

    eq('the pinned carrier leaves the bill only once the components step names a style', [carriersFromStepOf(null), carriersFromStepOf({ carrierStyle: '' }), carriersFromStepOf({ carrierStyle: 'HTSRIPCAR' })], [false, false, true]);
    const base = { priceLevel: 'STANDARD' };
    ok('…and then on a copy: the price context itself is never touched', pricingCtxOf(base, false) === base && pricingCtxOf(base, true) !== base && JSON.stringify(pricingCtxOf(base, true)) === JSON.stringify({ priceLevel: 'STANDARD', skipRoles: ['CARRIER'] }) && base.skipRoles === undefined);
    const asks = FIN.map(f => (f.code === 'LBR' ? { ...f, questions: [{ label: 'Surface', choices: ['Brushed', 'Polished'] }, { label: 'Coating', choices: ['Lacquered', 'Unlacquered'] }] } : f));
    const lines = { lines: [{ finishCode: 'lbr' }, { finishCode: 'P14' }, { finishCode: '' }, { finishCode: 'LBR' }] };
    const asking = askingFinishesOf(lines, finishIndexOf(asks));
    eq('the finishes that ASK, among those a line actually wears — each once', asking.map(a => [a.code, a.questions.map(q => q.label)]), [['LBR', ['Surface', 'Coating']]]);
    eq('a finish nobody wears asks nothing', askingFinishesOf({ lines: [{ finishCode: 'P14' }] }, finishIndexOf(asks)), []);
    eq('only the answers of finishes still worn travel with the line', liveFinishAnswersOf(asking, { LBR: { Surface: 'Polished' }, P14: { Sheen: 'Flat' } }), { LBR: { Surface: 'Polished' } });
    eq('every question is answered before the line leaves: the ones still open, by finish', [openFinishQuestionsOf(asking, {}).map(([a, m]) => [a.code, m]), openFinishQuestionsOf(asking, { LBR: { surface: 'polished' } }).map(([a, m]) => [a.code, m]), openFinishQuestionsOf(asking, { LBR: { Surface: 'Brushed', Coating: 'Lacquered' } })],
        [[['LBR', ['Surface', 'Coating']]], [['LBR', ['Coating']]], []]);
    const kitL = { isKit: true, itemKit: true, billedId: 'KIT1' }, sysL = { isKit: true, billedId: 'SYS' }, p1 = { inKit: true, hidden: true, kitOf: 'KIT1', billedId: 'A' }, p2 = { inKit: true, hidden: true, kitOf: 'KIT1', billedId: 'B' }, stray = { inKit: true, hidden: true, kitOf: 'OTHER' }, plain = { billedId: 'P' };
    eq('the parts each item-kit line brings: the hidden lines that follow it, its own, until anything else', [...kitPartsByLineOf({ lines: [plain, p1, kitL, p1, p2, stray, p1, sysL, p2] })].map(([l, ps]) => [l.billedId, ps.map(x => x.billedId)]), [['KIT1', ['A', 'B']]]);
    eq('…one entry per kit line', [...kitPartsByLineOf({ lines: [kitL, p1, p2, plain, { ...kitL, billedId: 'KIT2' }, { ...p1, kitOf: 'KIT2', billedId: 'C' }] })].map(([l, ps]) => [l.billedId, ps.map(x => x.billedId)]), [['KIT1', ['A', 'B']], ['KIT2', ['C']]]);

    const lib = [{ id: 'D-J', legacyErpId: 'JNR', itemName: 'Joiner', manufacturingSpecs: { basePrice: 20, customData: { unfinished: true } } }, { id: 'D-FEE', legacyErpId: 'PAINT-FEE', itemName: 'Paint to match', partClass: 'Fee', manufacturingSpecs: { basePrice: 45 } },
        { id: 'D-FEEP', legacyErpId: 'PAINT-FEE/EP', itemName: 'Paint to match (plated)', partClass: 'Fee', manufacturingSpecs: { basePrice: 90 } }, { id: 'D-RG', legacyErpId: 'RG', itemName: 'Ring', manufacturingSpecs: { basePrice: 3 } }];
    const find = (id) => partIn(partIndexOf(lib), id);
    const pc = priceCtxOf({ customerId: '', customer: null, effectiveLevel: 'STANDARD', levelIsDefault: false, outsourceCodes: [], globalFinish: 'P14', lineFinishFor: () => '', subFinishFor: () => '', findPart: find, finishByCode: finishIndexOf(FIN), flow: null, lengthFeet: 8, lengthInches: 96, drive: 'MANUAL' });
    const xl = extraLinesOf({ extras: [{ code: 'JNR', qty: '2', note: 'centre' }, { code: 'PAINT-FEE', qty: '1', slot: 'T|F' }, { code: 'PAINT-FEE', qty: '', slot: 'T|B' }, { code: 'RG', qty: '0' }, { code: '' }, { code: 'NOT-HELD', qty: '3' }], findPart: find, priceCtx: pc, globalFinish: 'P14', matchFinishOverride: { 'trk-f': 'EP4' }, livePicks: { 'T|F': 'trk-f', 'T|B': 'trk-b' } });
    eq('added by hand: an unfinished item prices plain and carries no finish; a paint-match fee prices at, and names, the colour it buys; the rest wear the configuration\'s',
        xl.map(l => [l.partId, l.qty, l.unit, l.total, l.finishCode, l.noFinish, l.slot || '', l.note || '']), [['JNR', 2, 20, 40, '', true, '', 'centre'], ['PAINT-FEE', 1, 90, 90, 'EP4', false, 'T|F', ''], ['PAINT-FEE', 1, 45, 45, 'P14', false, 'T|B', ''], ['RG', 1, 3, 3, 'P14', false, '', ''], ['NOT-HELD', 3, 0, 0, 'P14', false, '', '']]);
    ok('…each marked as added by hand, with the rule that priced it', xl.every(l => l.extra === true && typeof l.source === 'string') && xl[0].name === 'Joiner' && xl[4].name === 'NOT-HELD');

    const mdl = { choices: [{ id: 'a', role: 'FASCIA', rodKind: 'TRAVERSE' }, { id: 'b', role: 'ROD', rodKind: 'SOLID' }, { id: 'c', role: 'BRACKET', rodKind: 'TRAVERSE' }] };
    eq('a traverse configuration is one whose chosen ROD is a traverse rod', [isTraverseOf(mdl, { r: 'a' }), isTraverseOf(mdl, { r: 'b' }), isTraverseOf(mdl, { r: 'c' }), isTraverseOf(mdl, {})], [true, false, false, false]);
    eq('the chart starts at 4 ft; a double is two tracks', [trvFeetOf(null), trvFeetOf(3), trvFeetOf(9), trvTracksOf('double'), trvTracksOf('SINGLE'), trvTracksOf(undefined)], [4, 4, 9, 2, 1, 1]);
    eq('a component is priced, and named, by the same chain as everything else', [trvPriceOfCode('RG', find, pc), trvPriceOfCode('NOT-HELD', find, pc), trvItemInfoOf('RG', find, pc), trvItemInfoOf('NOT-HELD', find, pc)], [3, 0, { name: 'Ring', sku: '' }, null]);
    const RULES = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 4: 16, 8: 32 } }, { label: 'Splice', itemId: 'SPL', byFeet: { 8: 1 } }], configurator: [{ itemId: 'ENDSTOP', drive: 'BOTH', billable: false }, { itemId: 'SPL', drive: 'BOTH', billable: false }, { itemId: 'WAND', drive: 'MANUAL', billable: true }] };
    eq('the selection seeds from the chart — only for a traverse rod on a collection that has one', [trvSeedOf({ trvRules: RULES, isTraverse: true, trvDrive: 'MANUAL', trvFeet: 8, trvTracks: 2 }), trvSeedOf({ trvRules: RULES, isTraverse: false, trvDrive: 'MANUAL', trvFeet: 8, trvTracks: 1 }), trvSeedOf({ trvRules: null, isTraverse: true, trvDrive: 'MANUAL', trvFeet: 8, trvTracks: 1 })],
        [{ carrierStyle: '', carrierQty: '', draw: '', motorSide: '', picks: { ENDSTOP: 4, SPL: 1 }, accessories: {} }, null, null]);
    const comps = trvComponentsOf({ trvRules: RULES, isTraverse: true, trvLive: { carrierStyle: 'HTSLNTCAR', carrierQty: '40', picks: { SPL: 2 }, accessories: { WAND: 2 } }, trvDrive: 'MANUAL', trvFeet: 8, lengthFeet: 8, trvPriceOf: (c) => ({ HTSLNTCAR: 1.5, SPL: 20, WAND: 12 }[c] || 0) });
    eq('the components: the chart\'s count included, what is above it billed, an accessory billed', comps.map(c => [c.code, c.qty, c.rate, c.billable]), [['HTSLNTCAR', 32, 0, false], ['HTSLNTCAR', 8, 1.5, true], ['SPL', 1, 0, false], ['SPL', 1, 20, true], ['WAND', 2, 12, true]]);
    eq('…none without a traverse rod, a chart, or a selection', [trvComponentsOf({ trvRules: RULES, isTraverse: false, trvLive: {} }), trvComponentsOf({ trvRules: null, isTraverse: true, trvLive: {} }), trvComponentsOf({ trvRules: RULES, isTraverse: true, trvLive: null })], [[], [], []]);
    eq('on the quote an included component rides at $0 and says so', trvLinesOf(comps).map(l => [l.partId, l.qty, l.unit, l.total, /^included — /.test(l.detail), l.extra, l.source]), [['HTSLNTCAR', 32, 0, 0, true, true, 'traverse components'], ['HTSLNTCAR', 8, 1.5, 12, false, true, 'traverse components'], ['SPL', 1, 0, 0, true, true, 'traverse components'], ['SPL', 1, 20, 20, false, true, 'traverse components'], ['WAND', 2, 12, 24, false, true, 'traverse components']]);
    const same = (a, b) => sameItem(a, b, find);
    eq('the joiners on the line: the add-by-hand rows that are the flow\'s joiner (under any of its names) and the traverse chart\'s own', [spliceOnLineOf({ extras: [{ code: 'D-J', qty: '2' }, { code: 'RG', qty: '5' }, { code: 'JNR', qty: '0' }], spliceCodes: ['JNR'], sameItemCode: same, trvComponents: [...comps, { code: 'trv-joiner', qty: 2 }, { code: 'SPLICE-X', qty: 0 }] }),
        spliceOnLineOf({ extras: [{ code: 'D-J', qty: '2' }], spliceCodes: [], sameItemCode: same, trvComponents: comps }), spliceOnLineOf({ extras: [], spliceCodes: ['JNR'], sameItemCode: same, trvComponents: [] })], [4, 0, 0]);
    const one = (o) => shipsInOnePieceOf({ lengthInches: 150, spliceOverIn: 120, spliceCodes: ['JNR'], isTraverse: false, trvRules: null, spliceOnLine: 0, ...o });
    eq('over the limit with no joiner on the line — said only where a joiner could have been had', [one({}), one({ spliceOnLine: 1 }), one({ lengthInches: 120 }), one({ spliceCodes: [] }), one({ spliceCodes: [], isTraverse: true, trvRules: RULES }), one({ spliceCodes: [], isTraverse: true })], [true, false, false, false, true, false]);
    eq('what the configuration comes to: the lines, what was added by hand, the billable components', grandTotalOf({ total: 100 }, xl, comps), 100 + 178 + 56);
    eq('nothing resolved prices to nothing — with or without a kit in hand the bill has its shape', [pricedOf({ bom: [], choices: [] }, pc, null), Array.isArray(pricedOf({ bom: [], choices: [] }, pc, { kitCode: 'K', kitName: 'K', kitPrice: 195, baseFeet: 4, included: [] }).lines)], [{ lines: [], total: 0 }, true]);
    const warned = priceWarningsOf({ lines: [{ source: 'no price on this item', name: 'Hidden nut', detail: 'd', hidden: true }, { source: 'no price on this item', name: 'Bracket', billedId: 'BE', detail: 'nothing on BE' }, { source: 'item base price', name: 'Ring' }] });
    eq('a part with no price is called out — a hidden one is not the operator\'s to act on', [warned.length, /Bracket \(BE\)/.test(warned[0].msg), warned[0].sev], [1, true, 'red']);
    const bare = billOf({ findPart: find, model: { choices: [], slots: [] }, resolved: { bom: [], choices: [] }, livePicks: {}, finishByCode: finishIndexOf(FIN), globalFinish: '', lineFinishFor: () => '', subFinishFor: () => '', matchFinishOverride: {}, sameItemCode: same });
    eq('the bill of nothing: standard, no kit, no traverse, nothing owed', [bare.effectiveLevel, bare.levelIsDefault, bare.kitBill, bare.kitSaved, bare.isTraverse, bare.trvComponents, bare.grandTotal, bare.noSplice, bare.priced], ['STANDARD', false, null, { none: true }, false, [], 0, false, { lines: [], total: 0 }]);
}

// ── THE MOVE, the price: the module against the screen's old block, on the live H1-2TRV pins ───────────────────
// Every framing, several ways through the parts each, as five customers (nobody · Fabricut at their defaulted cost ·
// Fabricut with Retail chosen · another customer with a level of their own · another at standard), billed from no
// kit and from each of six (wall / ceiling, manual / motorized with its motors, a double with no ceiling twin, a
// family with one kit for both mounts), with the traverse components as seeded and as answered, items added by
// hand, finishes that ask — priced parts, parts with no price, a kit made of parts.
{
    const hh = (t) => { let x = 2166136261; for (const c of String(t)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
    const money = (code, lo, hi) => lo + (hh(code) % ((hi - lo) * 4)) / 4;
    const mk5 = (code, specs = {}, extra = {}) => ({ id: `PD-${code}`, itemId: `PD-${code}`, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory', manufacturingSpecs: specs, ...extra });
    const tiers = (code) => ({ cost: money(`${code}|c`, 5, 30), wholesale: money(`${code}|w`, 30, 60), retail: money(`${code}|r`, 60, 120), paintedCost: money(`${code}|pc`, 6, 32), paintedWholesale: money(`${code}|pw`, 32, 64), paintedRetail: money(`${code}|pr`, 64, 128),
        platedCost: money(`${code}|ec`, 12, 50), platedWholesale: money(`${code}|ew`, 50, 90), platedRetail: money(`${code}|er`, 90, 180), fabCodeBase: `H${hh(code) % 9000 + 1000}F`, fabCodePainted: `H${hh(code) % 9000 + 1000}F`, fabCodePremium: `H${hh(code) % 9000 + 1000}F PREMIUM` });
    const codes = [...new Map(PINS.map(pn => [pn.partId, pn.legacyErpId || pn.partName])).entries()];
    const pinned = codes.map(([id, code], i) => ({ id, itemId: id, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory',
        manufacturingSpecs: { ...(i % 4 !== 3 && code !== 'H1-2TRVNUT' ? { basePrice: money(code, 4, 40) } : {}), ...(i % 3 === 0 ? { fabricut: tiers(code) } : {}), ...(/^H1-2TRV-(WB|EWB)$/.test(code) ? { usesSubFinish: true } : {}), ...(code === 'H1-2RCTPR' ? { customData: { unfinished: true } } : {}) },
        ...(i % 2 ? { clientPricing: [{ customerId: 'FABRICUT', clientSku: `F${hh(code) % 9000 + 1000}`, price: money(`${code}|row`, 3, 35) }, { customerId: 'cust-brimar', clientSku: `B${hh(code) % 900 + 100}`, price: money(`${code}|brow`, 5, 45) }] } : {}) }));
    const idOfCode = (code) => (codes.find(([, c]) => c === code) || [])[0];
    // the bracket H1-2TRV-CB is sold as one number and made of two parts (an item kit)
    const cb = pinned.find(x => x.legacyErpId === 'H1-2TRV-CB');
    if (cb) { cb.partClass = 'Kit'; cb.manufacturingSpecs = { ...cb.manufacturingSpecs, basePrice: 61, kitComponents: [{ partId: 'PD-CB-ARM', qty: 1 }, { partId: 'PD-CB-CUFF', qty: 2 }, { partId: 'PD-NOT-HELD', qty: 1 }] }; }
    const lib5 = [...pinned, mk5('CB-ARM', { basePrice: 9 }), mk5('CB-CUFF', { basePrice: 4, customData: { unfinished: true } }),
        ...pinned.filter((x, i) => i % 3 === 1 && x.partClass !== 'Kit').flatMap(x => [mk5(`${x.legacyErpId}/P`, { basePrice: money(`${x.legacyErpId}/P`, 8, 60) }), mk5(`${x.legacyErpId}/EP4`, { basePrice: money(`${x.legacyErpId}/EP4`, 20, 90) })]),
        mk5('H1-2TRV-WB/C', { basePrice: 33 }), mk5('H1-2TRV-WB/B', {}), mk5('H1-2RCTWR-O', {}),
        mk5('PAINT-FEE', { basePrice: 45 }, { partClass: 'Fee' }), mk5('PAINT-FEE/EP', { basePrice: 90 }, { partClass: 'Fee' }), mk5('H1-2JNR', { basePrice: 20, customData: { unfinished: true } }), mk5('CONN-1', { basePrice: 7 }),
        mk5('HTSRIPCAR', { basePrice: 1.25 }), mk5('H1-2TRVSPL', { basePrice: 18 }), mk5('H1-2TRVMC', { basePrice: 6 }), mk5('ENDSTOP-2', {}), mk5('WAND-36', { basePrice: 14 }, { clientPricing: [{ customerId: 'FABRICUT', clientSku: 'HWAND', price: 11 }] }), mk5('REMOTE-1', { basePrice: 60 })];
    const kit5 = (code, align, { perFoot, specs = {}, family = 'H1-2TRV', price } = {}) => ({ id: `KIT-${code}`, itemId: `KIT-${code}`, legacyErpId: code, itemName: `System ${code}`, partClass: 'Kit',
        manufacturingSpecs: { kitFamily: family, kitAlign: { frontRail: 'TRACK', material: 'P', minFeet: 4, ...align }, ...specs },
        clientPricing: [{ customerId: 'FABRICUT', clientSku: `HTS-${hh(code) % 900 + 100}`, price: price ?? (150 + hh(code) % 100), ...(perFoot != null ? { perFootPrice: perFoot } : {}) }] });
    const KITS5 = [
        kit5('H1-2TRV-4/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL' }, { perFoot: 22 }),
        kit5('H1-2TRV-4C/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING' }, { perFoot: 24, specs: { kitComponents: [{ partId: idOfCode('H1-2RCTPR'), qty: 2 }, { partId: 'PD-CONN-1' }] } }),
        kit5('H1-2TRV-4M/P', { setup: 'SINGLE', drive: 'MOTORIZED', mount: 'WALL' }, { specs: { kitMotorCodes: [{ code: 'H1-2TRV-4M/P-35W', fabSku: 'HM35W', motorItem: 'HSOM-21', net: '1050' }, { code: 'H1-2TRV-4M/P-60W', fabSku: '', motorItem: 'HSOM-20', net: 1150 }] } }),
        kit5('H1-2TRV-4MC/P', { setup: 'SINGLE', drive: 'MOTORIZED', mount: 'CEILING' }, { specs: { kitMotorCodes: [{ code: 'H1-2TRV-4M/P-35C', fabSku: 'HM35C', motorItem: 'HSOM-21', net: 1075 }] } }),
        kit5('H1-2TRV-4D/P', { setup: 'DOUBLE', drive: 'MANUAL', mount: 'WALL' }),
        kit5('H1-138TRV-4H/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', rodKind: 'TRAVERSE', bracketStyle: 'H' }, { family: 'H1-138TRV', price: 0 }),
    ];
    const RULES5 = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 } }, { label: 'Ripplefold Carriers', itemId: 'HTSRIPCAR', byFeet: { 4: 12, 8: 24, 12: 36 } },
        { label: 'Wall brackets', itemId: 'H1-2TRV-WB', byFeet: { 4: 2, 8: 3, 12: 4 } }, { label: 'Splice', itemId: 'H1-2TRVSPL', byFeet: { 12: 1 } }],
        configurator: [{ itemId: 'H1-2TRVMC', drive: 'MANUAL', billable: false }, { itemId: 'ENDSTOP-2', drive: 'BOTH', billable: false }, { itemId: 'H1-2TRVSPL', drive: 'BOTH', billable: false }, { itemId: 'WAND-36', drive: 'MANUAL', billable: true }, { itemId: 'REMOTE-1', drive: 'MOTORIZED', billable: true }] };
    const FINQ = FIN.map(f => (f.code === 'EP4' ? { ...f, questions: [{ label: 'Sheen', choices: ['Bright', 'Satin'] }] } : f));
    const WHO = [{ customer: null, customerId: '', priceLevel: 'STANDARD' }, { customer: { id: 'C-FAB', name: 'FABRICUT' }, customerId: 'C-FAB', priceLevel: 'STANDARD' }, { customer: { id: 'C-FAB', name: 'Fabricut', companyName: 'FABRICUT' }, customerId: 'C-FAB', priceLevel: 'FAB_RETAIL' },
        { customer: { id: 'CUST-BRIMAR', name: 'Brimar', defaultPriceLevel: 'fab_wholesale' }, customerId: 'CUST-BRIMAR', priceLevel: 'STANDARD' }, { customer: { id: 'CUST-BRIMAR', name: 'Brimar', defaultPriceLevel: 'STANDARD' }, customerId: 'CUST-BRIMAR', priceLevel: 'STANDARD' }];
    const tally = { compared: 0, differ: 0, kit: 0, switched: 0, followed: 0, nokit: 0, motor: 0, motorTwin: 0, missingKit: 0, byCode: 0, carriersStep: 0, billedComp: 0, itemKit: 0, unfinishedExtra: 0, matchedFee: 0, noPrice: 0, fallback: 0, defaulted: 0, chosen: 0, asking: 0, open: 0, onePiece: 0, perFoot: 0, stock: 0, covered: 0 };
    const walk6 = { compared: 0, walk: 0, draw: 0, add: 0, kinds: {}, nested: 0, hints: 0, itemsOffStep: 0, notAsked: 0, refused: {}, lines: 0, shopNotes: 0, clientNotes: 0, ticksOnly: 0, onePiece: 0, multiples: 0, noModel: 0, drawnMarks: 0, spreadMarks: 0, marksMoved: 0, clones: 0, stretch: 0, clear: 0, noRings: 0, noRod: 0, removals: 0, typed: 0, typedDiffer: 0, typedBeside: 0, goneNamed: 0, partsWrong: 0 };
    const first6 = [];
    const firstDiff = [];
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 12; v++) {
            const rand = rng(`bill|${fi}|${v}`);
            const picks = picksFor(answers, `bill|${fi}|${v}`);
            const who = WHO[(fi + v) % WHO.length];
            const kit = v % 3 === 0 ? null : KITS5[(fi * 5 + v) % KITS5.length];
            const motors = kit ? (kit.manufacturingSpecs.kitMotorCodes || []) : [];
            const kitState = !kit ? {} : v % 7 === 5 ? { kitPick: 'KIT-GONE', kitMotor: 'X' } : v % 5 === 4 ? { kitCode: kit.legacyErpId.toLowerCase(), kitMotor: motors.length ? motors[0].code : '' } : { kitPick: kit.id, kitMotor: motors.length ? (v % 4 === 1 ? 'NOT-A-MOTOR' : motors[(fi + v) % motors.length].code) : '' };
            const chosenIds = Object.values(picks);
            const partFinish = {}; for (let kk = 0; kk < v % 3; kk++) partFinish[chosenIds[Math.floor(rand() * chosenIds.length)]] = ['P14', 'EP4', 'S04', 'ANTIQUE PEWTER'][Math.floor(rand() * 4)];
            const m0 = settle({ choices, answers, picks, modelNodes });
            const live0 = autoPicksOf({ model: m0, answers, operatorPicks: reseatPicks(m0, picks) }).livePicks;
            const tracks = m0.slots.filter(sl => sl.kind === 'TRACK' && live0[sl.key]);
            const extras = [...(v % 2 ? [{ code: 'H1-2JNR', qty: String(1 + (v % 3)), note: v % 4 === 1 ? '18 in from the left' : '' }] : []), ...(tracks.length && v % 3 === 1 ? [{ code: 'PAINT-FEE', qty: '1', note: '', slot: tracks[0].key }] : []), ...(v % 5 === 2 ? [{ code: 'CONN-1', qty: '4', note: '' }, { code: 'NOT-HELD', qty: '1', note: '' }] : [])];
            const drive = driveOf(answers.drive);
            const trvSel = v % 3 === 0 ? null : v % 3 === 1 ? { carrierStyle: v % 2 ? 'HTSRIPCAR' : 'HTSLNTCAR', carrierQty: '', draw: 'LEFT', motorSide: '', picks: defaultPicks({ rules: RULES5, drive, feet: 8, trackCount: 1 }), accessories: {} }
                : { carrierStyle: v % 2 ? 'HTSLNTCAR' : '', carrierQty: '60', draw: 'CENTER', motorSide: 'RIGHT', picks: { 'H1-2TRVSPL': 2, 'ENDSTOP-2': 2, 'H1-2TRVMC': 1 }, accessories: { 'WAND-36': 2, 'REMOTE-1': 1, 'NOT-OFFERED': 3 } };
            const data = { assembly: ASSEMBLY, pins: PINS, parts: lib5, flow: { fallbackPrices: v % 2 ? { BRACKET: 11, RING: 2, TRACK: 5 } : null, spliceOverInches: 96 }, trvRules: v % 6 === 5 ? null : RULES5, extraItems: [{ code: 'H1-2JNR', label: 'Joiner' }, { code: 'PAINT-FEE', label: 'Paint the track to match', step: 'track' }],
                finishes: FINQ, flowFinishes: [], ...who, outsourceCodes: FINQ.filter(f => f.vendor && f.material === 'METAL'), kits: KITS5 };
            const state = { answers, picks, lengthInches: [null, 36, 96, 150.5, 60][(fi + v) % 5], stepQty: {}, extras, spliceWaived: v % 4 >= 2, globalFinishes: [{}, { METAL: 'P14' }, { METAL: 'EP4', WOOD: 'S04' }, { METAL: 'ANTIQUE PEWTER', WOOD: 'S11' }][(fi + v) % 4], partFinish,
                finishAnswers: v % 2 ? { EP4: { Sheen: 'Satin' }, P14: { Depth: 'Deep' } } : (v % 4 === 2 ? { EP4: { Sheen: 'Matte' } } : null), ...kitState, ...(trvSel ? { trvSel } : {}) };
            const sn = sessionOf(data, state);
            const of = oldFinish({ finishes: data.finishes, flowFinishes: [], customer: who.customer, customerId: who.customerId, findPart: sn.findPart, model: sn.model, resolved: sn.resolved, livePicks: sn.livePicks, extras: sn.extras, globalFinishes: sn.globalFinishes, partFinish: sn.partFinish });
            const rk = oldKitRestore(KITS5, state);
            const ob = oldBill({ ...who, outsourceCodes: data.outsourceCodes, flow: data.flow, kits: KITS5, trvRules: data.trvRules, findPart: sn.findPart, model: sn.model, resolved: sn.resolved, livePicks: sn.livePicks, extras: sn.extras, lengthFeet: sn.lengthFeet, lengthInches: sn.lengthInches,
                spliceCodes: sn.spliceCodes, spliceOverIn: sn.spliceOverIn, sameItemCode: sn.sameItemCode, finishByCode: of.finishByCode, globalFinish: of.globalFinish, lineFinishFor: of.lineFinishFor, subFinishFor: of.subFinishFor, matchFinishOverride: of.matchFinishOverride,
                answers, kitSource: rk.kitSource, kitMotor: rk.kitMotor, trvSel: trvSel ? { ...trvSel } : null, finishAnswers: state.finishAnswers || {} });
            const said = (x, open, kitNow) => JSON.stringify({ level: [x.effectiveLevel, x.levelIsDefault], ctx: x.priceCtx, species: (x.priceCtx.finishObjOf('s04') || {}).id, ctxFinish: [...sn.model.choices].slice(0, 6).map(c => [x.priceCtx.finishFor(c), x.priceCtx.subFinishFor(c)]), kitNow, kitBill: x.kitBill,
                carriers: x.carriersFromStep, skip: x.pricingCtx.skipRoles || null, priced: x.priced, warnings: x.priceWarnings, asking: x.askingFinishes.map(a => [a.code, a.questions]), live: x.liveFinishAnswers, open: open.map(([a, mm]) => [a.code, mm]),
                kitParts: [...x.kitPartsByLine].map(([l, ps]) => [l.billedId, ps.map(q => q.billedId)]), extraLines: x.extraLines, trv: [x.isTraverse, x.trvDrive, x.trvFeet, x.trvTracks, x.trvSeed, x.trvLive, x.trvComponents, x.trvLines],
                info: ['HTSLNTCAR', 'WAND-36', 'NOT-HELD'].map(c => [x.trvPriceOf(c), x.trvItemInfo(c)]), splice: [x.spliceOnLine, x.noSplice], total: x.grandTotal });
            tally.compared++;
            if (said(ob, ob.openQuestions, [rk.kitPick, rk.kitMotor, rk.kitSource]) !== said(sn, sn.openFinishQuestions, [sn.kitPick, sn.kitMotor, sn.kitSource])) { tally.differ++; if (firstDiff.length < 3) firstDiff.push(`#${fi}.${v}`); }
            const kb = sn.kitBill;
            if (kb) { tally.kit++; if (kb.mountFollow) tally[kb.mountFollow.mode] = (tally[kb.mountFollow.mode] || 0) + 1; if (kb.motor) tally.motor++; if (kb.mountFollow && kb.mountFollow.mode === 'switched' && kb.motor) tally.motorTwin++; if (kb.perFootPrice != null) tally.perFoot++; if (kb.included.some(i => i.qty > 0)) tally.covered++; }
            if (sn.kitSaved.missing) tally.missingKit++;
            if (state.kitCode && sn.kitSource) tally.byCode++;
            if (sn.carriersFromStep) tally.carriersStep++;
            if (sn.trvComponents.some(c => c.billable)) tally.billedComp++;
            if (sn.priced.lines.some(l => l.itemKit)) tally.itemKit++;
            if (sn.extraLines.some(l => l.noFinish)) tally.unfinishedExtra++;
            if (sn.extraLines.some(l => l.slot && l.finishCode && l.finishCode !== sn.globalFinish)) tally.matchedFee++;
            if (sn.priced.lines.some(l => /no price/.test(l.source))) tally.noPrice++;
            if (sn.priced.lines.some(l => /flow default/.test(l.source))) tally.fallback++;
            if (sn.levelIsDefault) tally.defaulted++; else if (sn.effectiveLevel !== 'STANDARD') tally.chosen++;
            if (sn.askingFinishes.length) tally.asking++;
            if (sn.openFinishQuestions.length) tally.open++;
            if (sn.noSplice) tally.onePiece++;
            if (sn.priced.lines.some(l => l.subFinishCode)) tally.stock++;
            // ── MOVE 6, the same set-up WALKED: notes on its steps, ticks, a memo, a multiplier, a drawing's splices, items named
            //    for their steps — one way in four with the parts of the NEXT framing (a later answer removes some: named, then
            //    acknowledged), one in seven with no ring pinned at all (the carriers take the rings' place), one in eleven with
            //    no rod, fascia or track pinned, one in nine with no model to draw ──
            {
                const strip = v % 7 === 3 ? ['RING'] : v % 11 === 5 ? ['ROD', 'FASCIA', 'TRACK'] : null;
                const gone = strip ? new Set(choices.filter(c => strip.includes(c.role)).map(c => c.id)) : null;
                const pins6 = gone ? PINS.filter(pn => !gone.has(String(pn.id || pn.choiceNode || pn.partId || ''))) : PINS;
                const picks6 = v % 4 === 3 ? picksFor(framings[(fi + 1) % framings.length], `walk|${fi}|${v}`) : picks;
                const keys6 = ['length', 'axes:framing', 'axis:proj', 'carriers', 'traverse', ...Object.keys(picks6)];
                const k1 = keys6[(fi * 3 + v) % keys6.length], k2 = keys6[(fi + v * 5) % keys6.length];
                const notes6 = v % 3 === 0 ? null : { [k1]: `note on ${k1}`, ...(v % 2 ? { [k2]: '  typed  with   stray spaces ' } : {}), ...(v % 5 === 1 ? { 'gone:step': 'typed on a step no longer in the walk' } : {}) };
                const ticks6 = v % 4 === 1 ? { [k1]: true } : v % 4 === 2 ? { length: true, 'gone:step': true } : null;
                const drawn6 = v % 5 === 0 ? [{ distInches: 30, ref: 'START' }] : v % 5 === 1 ? [{ distInches: 24, ref: 'end' }, { distInches: 40.5 }] : v % 5 === 2 ? [{ distInches: null, ref: '' }, { distInches: 9999, ref: 'START' }] : null;
                const data6 = { ...data, flow: { ...data.flow, id: 'FLOW-H1-2TRV', name: 'H1 2" Traverse' }, pins: pins6, assembly: v % 9 === 8 ? ASSEMBLY : { ...ASSEMBLY, manufacturingSpecs: { ...(ASSEMBLY.manufacturingSpecs || {}), cadUrl: 'https://models.test/h1-2trv.glb' } },
                    extraItems: [{ code: 'H1-2JNR', label: 'Joiner', step: v % 2 ? 'rod length' : '' }, { code: 'PAINT-FEE', label: 'Paint the track to match', step: 'track' }, { code: 'CONN-1', label: 'Connector', step: v % 2 ? 'bracket' : 'left bracket (and the right)' }, { code: 'WAND-36', label: 'Wand — wood rods only', rodMaterials: ['WOOD'] }] };
                const state6 = { ...state, extras: [...extras, ...(v % 5 === 3 ? [{ code: 'CONN-1', qty: '0', note: 'typed, then taken off' }] : [])], picks: picks6, ...(notes6 ? { stepNotes: notes6 } : {}), ...(ticks6 ? { stepNoteClient: ticks6 } : {}), memo: v % 3 ? `Room ${fi}-${v}` : '', ...(v % 6 === 4 ? { memo: '', sidemark: 'From the drawing' } : {}),
                    qty: ['1', '2', 0, 'x', 3][(fi + v) % 5], ...(drawn6 ? { drawnSplices: drawn6 } : {}) };
                const run6 = (st6) => {
                    const n6 = sessionOf(data6, st6);
                    const of6 = oldFinish({ finishes: data6.finishes, flowFinishes: [], customer: who.customer, customerId: who.customerId, findPart: n6.findPart, model: n6.model, resolved: n6.resolved, livePicks: n6.livePicks, extras: n6.extras, globalFinishes: n6.globalFinishes, partFinish: n6.partFinish });
                    const rk6 = oldKitRestore(KITS5, st6);
                    const ob6 = oldBill({ ...who, outsourceCodes: data6.outsourceCodes, flow: data6.flow, kits: KITS5, trvRules: data6.trvRules, findPart: n6.findPart, model: n6.model, resolved: n6.resolved, livePicks: n6.livePicks, extras: n6.extras, lengthFeet: n6.lengthFeet, lengthInches: n6.lengthInches,
                        spliceCodes: n6.spliceCodes, spliceOverIn: n6.spliceOverIn, sameItemCode: n6.sameItemCode, finishByCode: of6.finishByCode, globalFinish: of6.globalFinish, lineFinishFor: of6.lineFinishFor, subFinishFor: of6.subFinishFor, matchFinishOverride: of6.matchFinishOverride,
                        answers, kitSource: rk6.kitSource, kitMotor: rk6.kitMotor, trvSel: trvSel ? { ...trvSel } : null, finishAnswers: st6.finishAnswers || {} });
                    // the state the screen's Edit restore set, field by field (its reopen effect)
                    const drawnSplices = Array.isArray(st6.drawnSplices) ? st6.drawnSplices.map(sp => ({ distInches: sp.distInches, ref: sp.ref || '' })) : [];
                    const stepNotes = { ...(st6.stepNotes || {}) };
                    const stepNoteClient = (st6.stepNoteClient && typeof st6.stepNoteClient === 'object') ? { ...st6.stepNoteClient } : {};
                    const ow = oldWalk({ model: n6.model, settledKeys: n6.settledKeys, isTraverse: ob6.isTraverse, trvRules: data6.trvRules, sizeSteps: n6.sizeSteps, sizeProjInches: n6.sizeProjInches, answers, livePicks: n6.livePicks, lengthFeet: n6.lengthFeet, lengthInches: n6.lengthInches,
                        ourId: n6.ourId, trvLive: ob6.trvLive, trvComponents: ob6.trvComponents, sizePick: {}, offeredExtraItems: n6.offeredExtraItems, resolved: n6.resolved, extras: n6.extras, spliceCodes: n6.spliceCodes, drawnSplices, quantities: n6.quantities });
                    const marks6 = newMarksOf(n6.splice, drawnSplices, n6.lengthInches);   // (2026-10-20 — newMarksOf above)
                    if (canon(marks6) !== canon(ow.spliceMarks)) walk6.marksMoved++;
                    // ⚠ DELIBERATE RULE CHANGE, 2026-10-13 (Stuart: "fix both"): a saved pick that is not among the choices any more
                    // is NAMED (Shared/pickDrops, its own harness) — the screen's reader as it was passed it over. The reference
                    // reads the removals with that rule; everything else below is still the screen's code as it was.
                    const drops = mergeDrops(Array.isArray(st6.drops) ? st6.drops : [], droppedPicks(n6.model, st6.picks, n6.livePicks, { labelOf: oldSlotLabel, everyChoice: choicesFromAssembly(data6.assembly, data6.pins), savedParts: st6.pickParts || {} }));
                    const passedOver = droppedPicks(n6.model, st6.picks, n6.livePicks, { labelOf: oldSlotLabel });
                    const pendingDrops = unacknowledged(drops);
                    const addArgs = { priced: ob6.priced, pendingDrops, oldBareWood: of6.bareWood, oldOpenQuestions: ob6.openQuestions, resolved: n6.resolved, pricingCtx: ob6.pricingCtx, assembly: data6.assembly, flow: data6.flow, findPart: n6.findPart,
                        cfgQty: String(parseInt(st6.qty, 10) > 0 ? parseInt(st6.qty, 10) : 1), pins: data6.pins, configMemo: st6.memo || st6.sidemark || '', chosenFinishObjects: of6.chosenFinishObjects, effectiveLevel: ob6.effectiveLevel, lengthInches: n6.lengthInches, lengthFeet: n6.lengthFeet,
                        extras: n6.extras, extraLines: ob6.extraLines, stepNotes, stepNoteClient, answers, livePicks: n6.livePicks, partFinish: n6.partFinish, globalFinish: of6.globalFinish, globalFinishes: n6.globalFinishes, stepQty: st6.stepQty || {},
                        liveFinishAnswers: ob6.liveFinishAnswers, kitBill: ob6.kitBill, kitSource: rk6.kitSource, kitPick: rk6.kitPick, kitMotor: rk6.kitMotor, isTraverse: ob6.isTraverse, trvSel: trvSel ? { ...trvSel } : null, trvComponents: ob6.trvComponents, trvLive: ob6.trvLive,
                        cadUrl: data6.assembly?.manufacturingSpecs?.cadUrl, textureOverrides: of6.textureOverrides, visibleOverrides: ow.visibleOverrides, cloneSpecs: ow.cloneSpecs, stretchSpec: ow.stretchSpec, spliceMarks: marks6, clearList: ow.clearList,
                        steps: ow.steps, noSplice: ob6.noSplice, spliceOverIn: n6.spliceOverIn };
                    const oa = oldAdd(addArgs);
                    const walkSaid = (w) => canon([w.steps, w.steps.map(st => [w.hintFor(st), w.extrasOnStep(st).map(it => it.code), w.answerOf(st)])]);
                    const drawSaid = (w) => canon([w.visibleOverrides, w.clearList, w.railNames, w.stretchSpec, w.spliceMarks, w.cloneSpecs, w.chosen]);
                    // …and a second one, the same day: the line keeps, beside its picks, WHICH PART each one was (engineConfig.pickParts).
                    // The line is compared with the screen's without that record; the record itself is checked on its own, below.
                    // ⚠ DELIBERATE RULE CHANGES, 2026-10-19 (Stuart: "make the default for all screens drywall" · "a center bracket is
                    // always required there"): every line now records its wall fixing (engineConfig.onStud — checked on its own below),
                    // and a SPLICED pole whose centre step offers a bracket nobody chose is refused (SPLICE_CENTRE) where the screen's
                    // code built the line. Everything else is still the screen's code as it was.
                    const bare = (it) => { if (!it) return null; const c = JSON.parse(JSON.stringify(it)); delete c.id; if (c.engineConfig) { delete c.engineConfig.pickParts; delete c.engineConfig.onStud; } return c; };
                    walk6.compared++;
                    if (n6.item && n6.item.engineConfig.onStud !== n6.span.onStud) { walk6.add++; if (first6.length < 3) first6.push(`fixing not kept #${fi}.${v}`); }
                    const spliceGate = !!n6.refusal && n6.refusal.kind === 'SPLICE_CENTRE';
                    if (spliceGate) {
                        // (checked after "nothing priced" and the removals, before the finish refusals — where the screen's code refused
                        // for bare wood or an open finish question, this names the missing centre bracket first)
                        if (n6.splice.count > 0 && n6.model.slots.some(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && !sl.suppressedBy && sl.options.length && !n6.livePicks[sl.key])) {
                            walk6.spliceCentre = (walk6.spliceCentre || 0) + 1; if (!oa.item) walk6.spliceFirst = (walk6.spliceFirst || 0) + 1;
                        } else { walk6.add++; if (first6.length < 3) first6.push(`splice gate #${fi}.${v}`); }
                    }
                    if (walkSaid(ow) !== walkSaid({ steps: n6.steps, hintFor: stepHintOf, extrasOnStep: n6.extrasOnStep, answerOf: n6.answerOf })) { walk6.walk++; if (first6.length < 3) first6.push(`walk #${fi}.${v}`); }
                    if (drawSaid({ ...ow, spliceMarks: marks6 }) !== drawSaid(n6)) { walk6.draw++; if (first6.length < 3) first6.push(`draw #${fi}.${v}`); }
                    if (!spliceGate && (canon([oa.said, bare(oa.item), oa.dropRefusal, oa.cfgQtyN, drops]) !== canon([n6.refusal && n6.refusal.alert ? [n6.refusal.alert] : [], bare(n6.item), n6.dropRefusal, n6.qty, n6.drops])
                        || !!n6.refusal !== (oa.item === null))) { walk6.add++; if (first6.length < 3) first6.push(`add #${fi}.${v}`); }
                    // A ROW TYPED TO NOTHING — 0 into an empty quantity box. Only the screen can hold one (a saved line never does: the
                    // restore reads its count as at least one), so it is handed to the Add itself, old and new, on the same typed rows:
                    // alone on the line, beside rows that were taken, and on one step while the same item is taken on another.
                    if (n6.item) {
                        const typedRows = [...(v % 3 === 0 ? [] : n6.extras), { code: 'CONN-1', qty: '0', note: 'typed, nothing', slot: 'STEP|ONE' }, ...(v % 2 ? [{ code: 'CONN-1', qty: '2', note: '', slot: 'STEP|TWO' }] : []), ...(v % 4 === 1 ? [{ code: 'WAND-36', qty: '', note: '' }] : [])];
                        const typedLines = extraLinesOf({ extras: typedRows, findPart: n6.findPart, priceCtx: n6.priceCtx, globalFinish: n6.globalFinish, matchFinishOverride: n6.matchFinishOverride, livePicks: n6.livePicks });
                        const was = oldAdd({ ...addArgs, extras: typedRows, extraLines: typedLines }).item;
                        const now = cartLineOf({ resolved: n6.resolved, pricingCtx: n6.pricingCtx, assembly: data6.assembly, flow: data6.flow, findPart: n6.findPart, qty: n6.qty, renderSnapshot: null, pins: data6.pins, memo: n6.memo,
                            chosenFinishObjects: n6.chosenFinishObjects, effectiveLevel: n6.effectiveLevel, lengthInches: n6.lengthInches, lengthFeet: n6.lengthFeet, extras: typedRows, extraLines: typedLines, stepNotes: n6.stepNotes, stepNoteClient: n6.stepNoteClient,
                            answers, livePicks: n6.livePicks, partFinish: n6.partFinish, globalFinish: n6.globalFinish, globalFinishes: n6.globalFinishes, stepQty: st6.stepQty || {}, liveFinishAnswers: n6.liveFinishAnswers,
                            kitBill: n6.kitBill, kitSource: n6.kitSource, kitPick: n6.kitPick, kitMotor: n6.kitMotor, isTraverse: n6.isTraverse, trvSel: n6.trvSel, trvComponents: n6.trvComponents, trvLive: n6.trvLive, renderState: n6.renderState,
                            steps: n6.steps, noSplice: n6.noSplice, spliceOverIn: n6.spliceOverIn });
                        walk6.typed++;
                        if (canon(bare(was)) !== canon(bare(now))) { walk6.typedDiffer++; if (first6.length < 3) first6.push(`typed #${fi}.${v}`); }
                        if (typedLines.length !== takenExtraLinesOf(typedLines, typedRows).length && takenExtraLinesOf(typedLines, typedRows).length) walk6.typedBeside++;
                    }
                    if (drops.length > passedOver.length) walk6.goneNamed++;
                    if (n6.item) {
                        const pp = n6.item.engineConfig.pickParts || {};
                        const right = Object.keys(n6.livePicks).filter(kk => n6.livePicks[kk]).every(kk => { const c = n6.model.choices.find(x => x.id === n6.livePicks[kk]); const pt = n6.findPart(c.partId);
                            return pp[kk] && pp[kk].partId === String(c.partId) && pp[kk].code === n6.ourId(c.partId) && pp[kk].name === String((pt && pt.itemName) || c.name || ''); })
                            && Object.keys(pp).length === Object.keys(n6.livePicks).filter(kk => n6.livePicks[kk]).length;
                        if (!right) { walk6.partsWrong++; if (first6.length < 3) first6.push(`parts #${fi}.${v}`); }
                    }
                    n6.steps.forEach(st => { walk6.kinds[st.kind] = (walk6.kinds[st.kind] || 0) + 1; if (st.sub) walk6.nested++; if (stepHintOf(st)) walk6.hints++; if (st.kind !== 'LENGTH' && n6.extrasOnStep(st).length) walk6.itemsOffStep++; if (n6.answerOf(st) === 'not asked') walk6.notAsked++; });
                    if (n6.refusal) walk6.refused[n6.refusal.kind] = (walk6.refused[n6.refusal.kind] || 0) + 1;
                    if (n6.item) { walk6.lines++; const it = n6.item; if ((it.generalNotes || []).length) walk6.shopNotes++; if ((it.clientNotes || []).length) walk6.clientNotes++; if (it.engineConfig.stepNoteClient && !(it.clientNotes || []).length) walk6.ticksOnly++;
                        if (it.engineConfig.spliceWaived) walk6.onePiece++; if (Number(it.qty) > 1) walk6.multiples++; if (!it.renderState) walk6.noModel++; }
                    if (n6.spliceMarks.length) { if (drawnSplices.some(sp => sp.distInches != null) && n6.lengthInches > 0) walk6.drawnMarks++; else walk6.spreadMarks++; }
                    if (n6.cloneSpecs.some(cs => cs.count > 1)) walk6.clones++; if (n6.stretchSpec) walk6.stretch++; if (n6.clearList.length) walk6.clear++;
                    if (strip && strip[0] === 'RING') walk6.noRings++; if (strip && strip[0] === 'ROD') walk6.noRod++;
                    return n6;
                };
                const first = run6(state6);
                if (first.pendingDrops.length) { walk6.removals++; run6({ ...state6, drops: first.drops.map(d => ({ ...d, acked: true })) }); }
            }
        }
    });
    if (process.env.HS_VERBOSE) console.log('price —', JSON.stringify(tally));
    eq(`the price: the module agrees with the old inline block on every bill (${tally.compared} set-ups compared)${firstDiff.length ? ` — first: ${firstDiff.join(', ')}` : ''}`, tally.differ, 0);
    ok(`the set-ups take each rule's road — a kit ${tally.kit} (switched to the other mount's ${tally.switched}, followed ${tally.followed}, no kit for that mount ${tally.nokit}, a motor folded on ${tally.motor}, the motor's twin ${tally.motorTwin}, a per-foot rate ${tally.perFoot}, parts covered ${tally.covered}), a kit no longer offered ${tally.missingKit}, named by its number ${tally.byCode}, carriers from the step ${tally.carriersStep}, a billed component ${tally.billedComp}, an item kit ${tally.itemKit}, an unfinished item added ${tally.unfinishedExtra}, a matched fee ${tally.matchedFee}, no price ${tally.noPrice}, a flow default ${tally.fallback}, a defaulted level ${tally.defaulted}, a chosen one ${tally.chosen}, a finish that asks ${tally.asking}, questions open ${tally.open}, one piece ${tally.onePiece}, a stock colour ${tally.stock}`,
        tally.kit > 30 && tally.switched > 3 && tally.followed > 3 && tally.nokit > 0 && tally.motor > 3 && tally.motorTwin > 0 && tally.perFoot > 5 && tally.covered > 20 && tally.missingKit > 3 && tally.byCode > 3 && tally.carriersStep > 10 && tally.billedComp > 5 && tally.itemKit > 5
        && tally.unfinishedExtra > 10 && tally.matchedFee > 0 && tally.noPrice > 5 && tally.fallback > 5 && tally.defaulted > 20 && tally.chosen > 10 && tally.asking > 10 && tally.open > 3 && tally.onePiece > 3 && tally.stock > 3);
    // ── MOVE 6: the walk, what is drawn, the refusals at Add and the cart line — the module against the screen's code as it was ──
    if (process.env.HS_VERBOSE) console.log('walk —', JSON.stringify(walk6));
    eq(`the walk: the module's steps, hints, the items offered on each step and the answer under each heading are the screen's (${walk6.compared} set-ups walked)${first6.length ? ` — first: ${first6.join(', ')}` : ''}`, walk6.walk, 0);
    eq('what is drawn: the nodes shown, the clear parts, the rail, the stretch, the splice lines, the cloned centre brackets, the parts counted', walk6.draw, 0);
    eq('the Add: refused for the same reason in the same words, or the same cart line — every field, the frozen render and the notes with it', walk6.add, 0);
    eq(`the line keeps which part each pick was — the record's id, our number and its name, one for every pick on the line and no other; and a pick whose pin is not on the assembly is named where the screen's reader passed it over (${walk6.goneNamed} set-ups)`, [walk6.partsWrong, walk6.goneNamed > 5], [0, true]);
    eq(`…and with a row typed to nothing on it — alone, beside rows that were taken (${walk6.typedBeside}), on one step while the same item is taken on another — the Add hands on what the screen's did (${walk6.typed} lines)`, [walk6.typedDiffer, walk6.typed > 50, walk6.typedBeside > 20], [0, true, true]);
    ok(`the set-ups take each road of the walk — steps ${JSON.stringify(walk6.kinds)}, the track hint ${walk6.hints}, items offered off the length step ${walk6.itemsOffStep}, "not asked" ${walk6.notAsked}, refused ${JSON.stringify(walk6.refused)}, removals named then acknowledged ${walk6.removals}, lines ${walk6.lines} (shop notes ${walk6.shopNotes}, customer notes ${walk6.clientNotes}, ticks with nothing to print ${walk6.ticksOnly}, one piece ${walk6.onePiece}, more than one build ${walk6.multiples}, no model ${walk6.noModel}), splice lines drawn where placed ${walk6.drawnMarks} / spread ${walk6.spreadMarks} (${walk6.marksMoved} drawing fewer or more than one per joiner — the 10-20 rule), stretched ${walk6.stretch}, clear parts ${walk6.clear}, no rings pinned ${walk6.noRings}, no rod pinned ${walk6.noRod}`,
        walk6.kinds.AXES > 50 && walk6.kinds.AXIS > 20 && walk6.kinds.SLOT > 500 && walk6.kinds.LENGTH === walk6.compared && walk6.kinds.CARRIERS > 3 && walk6.kinds.TRV > 30 && walk6.hints > 20 && walk6.itemsOffStep > 50 && walk6.notAsked > 20
        && walk6.refused.NOTHING_PRICED > 0 && walk6.refused.REMOVALS > 3 && walk6.refused.BARE_WOOD > 3 && walk6.refused.FINISH_QUESTIONS > 3 && walk6.removals > 3 && walk6.lines + (walk6.spliceCentre || 0) > 100 && (walk6.spliceCentre || 0) > 10 && walk6.shopNotes > 30 && walk6.clientNotes > 10 && walk6.ticksOnly > 3
        && walk6.onePiece > 0 && walk6.multiples > 10 && walk6.noModel > 3 && walk6.drawnMarks > 3 && walk6.spreadMarks > 3 && walk6.stretch > 50 && walk6.clear > 50 && walk6.noRings > 5 && walk6.noRod > 3);
    // the kit a reopened line names: found the way the screen's restore effect found it
    const cases5 = [{}, { kitPick: 'KIT-H1-2TRV-4/P' }, { kitPick: 'KIT-H1-2TRV-4M/P', kitMotor: 'H1-2TRV-4M/P-35W' }, { kitCode: 'h1-2trv-4c/p' }, { kitPick: 'GONE', kitCode: 'H1-2TRV-4D/P' }, { kitPick: 'GONE' }, { kitCode: 'NOPE', kitMotor: 'x' }];
    eq('the kit a reopened line names: by its id, else by its number; one no longer offered is named; none is none', cases5.map(st => { const o = oldKitRestore(KITS5, st); const nw = kitFromSaved(KITS5, st);
        return JSON.stringify([o.kitPick, o.kitSource, o.report]) === JSON.stringify([nw.kitPick || '', nw.kitSource || null, nw.missing || null]) && !!nw.none === (!st.kitPick && !st.kitCode); }).every(Boolean), true);
}

// ── THE RULES, the walk: on models made for the purpose — and each one through the screen's old code as well ───
{
    const opt = (id, extra = {}) => ({ id, partId: `P-${id}`, name: `Part ${id}`, nodes: [`${id}_Mesh`], ...extra });
    const sl = (kind, position = '', extra = {}) => ({ kind, key: `${kind}|${extra.tier || ''}|${position}`, position, options: [opt(`${kind}-${extra.tier || ''}${position}-1`), opt(`${kind}-${extra.tier || ''}${position}-2`)], rejected: [], ...extra });
    const ax = (key, values, implied = false) => ({ key, values, implied, label: key });
    const mini = (slots, axes = [], riders = []) => ({ axes, slots, riders, choices: slots.flatMap(x => x.options.map(o => ({ ...o, role: x.kind }))) });
    const named = (steps) => steps.map(st => `${st.label}${st.sub ? ` [+${st.sub.key}]` : ''}`);
    const walkOf = (model, o = {}) => stepsOf({ model, isTraverse: false, trvRules: null, sizeSteps: [], sizeProjInches: null, settledKeys: new Set(), ...o });
    const refOf = (model, o = {}) => oldWalk({ model, isTraverse: false, trvRules: null, sizeSteps: [], sizeProjInches: null, settledKeys: new Set(), answers: {}, livePicks: {}, lengthFeet: null, lengthInches: null, ourId: (id) => id, trvLive: null, trvComponents: [], sizePick: {},
        offeredExtraItems: [], resolved: { visible: new Set(), clear: new Set(), slots: model.slots }, extras: [], spliceCodes: [], drawnSplices: [], quantities: {}, ...o }).steps;
    const both = []; const walked = (model, o) => { const st = walkOf(model, o); both.push(canon(st) === canon(refOf(model, o))); return named(st); };

    // the words
    eq('a projection answers as the trade writes it; anything else in the tag\'s own word, capitalised', [valueLabel('proj', 0.75), valueLabel('proj', '3.625'), valueLabel('proj', 4.625), valueLabel('proj', 6), valueLabel('proj', 5.5), valueLabel('mount', 'CEILING'), valueLabel('drive', 'MOTORIZED')],
        ['.75"', '3-5/8"', '4-5/8"', '6"', '5.5"', 'Ceiling', 'Motorized']);
    eq('the two ways a double carries its front layer are said as the product', [valueLabel('frontLayer', 'FASCIA'), valueLabel('frontLayer', 'TRACK')], ['Stationary fascia with rings (one track)', 'Traverse track front & rear']);
    eq('a step is named for its rod, its side and its kind — an end is an End Treatment; a single does not say Front / Back', [slotLabel({ kind: 'END', position: 'LEFT', tier: 'FRONT' }), slotLabel({ kind: 'END', position: 'LEFT', tier: 'BACK', tierSolo: true }), slotLabel({ kind: 'ROD', tier: 'BACK' }), slotLabel({ kind: 'BRACKET', position: 'CENTER' }), slotLabel({ kind: 'TRV_END', position: 'RIGHT' }), slotLabel({ kind: 'RING' })],
        ['Front Left End Treatment', 'Left End Treatment', 'Back Rod', 'Center Bracket', 'Right Trv end', 'Ring']);
    ok('…the same words the screen used, on every question and every slot of the live pins', Object.keys(AXIS_LABEL).every(k => AXIS_LABEL[k] === OLD_AXIS_LABEL[k]) && Object.keys(OLD_AXIS_LABEL).length === Object.keys(AXIS_LABEL).length
        && framings.every(a => modelOf(a, {}).slots.every(x => slotLabel(x) === oldSlotLabel(x)) && Object.entries(a).every(([k, v]) => valueLabel(k, v) === oldValueLabel(k, v))));

    // the order of the walk
    const framed = [ax('rodKind', ['SOLID', 'TRAVERSE']), ax('setup', ['SINGLE', 'DOUBLE']), ax('mount', ['WALL']), ax('drive', ['MANUAL', 'MOTORIZED'], true), ax('proj', [3.625, 6])];
    eq('the framing questions are ONE step, projection keeps its own, the length is asked right after the last rod, a plate is chosen under its arm',
        walked(mini([sl('ROD'), sl('END', 'LEFT'), sl('END', 'RIGHT'), sl('BRACKET', 'LEFT'), sl('BRACKET', 'CENTER'), sl('BACKPLATE', 'LEFT'), sl('BACKPLATE', 'CENTER'), sl('RING')], framed)),
        ['Rod Setup', 'Bracket Projection', 'Rod', 'Pole length', 'Left End Treatment', 'Right End Treatment', 'Left Bracket [+BACKPLATE||LEFT]', 'Center Bracket [+BACKPLATE||CENTER]', 'Ring']);
    eq('one framing question alone is headed by its own name; a question with one answer, or already implied, is never asked', walked(mini([sl('ROD')], [ax('mount', ['WALL', 'CEILING']), ax('setup', ['SINGLE']), ax('drive', ['MANUAL', 'MOTORIZED'], true)])), ['Mount', 'Rod', 'Pole length']);
    eq('a flow that asks the size asks it first, and its projection IS the projection question', walked(mini([sl('ROD')], framed), { sizeSteps: [{ id: 'SIZE-DIA', title: 'Rod Diameter' }, { id: 'SIZE-PROJ', title: 'Projection' }], sizeProjInches: 6 }),
        ['Rod Diameter', 'Projection', 'Rod Setup', 'Rod', 'Pole length']);
    eq('the length follows the LAST of rod, fascia and track', walked(mini([sl('FASCIA', '', { tier: 'FRONT' }), sl('TRACK', '', { tier: 'BACK' }), sl('END', 'LEFT')])), ['Front Fascia', 'Back Track', 'Pole length', 'Left End Treatment']);
    eq('with nothing pinned as a rod the length comes right after the last lone question — or, with none, last', [walked(mini([sl('END', 'LEFT')], [ax('setup', ['SINGLE', 'DOUBLE']), ax('proj', [3.625, 6])])), walked(mini([sl('END', 'LEFT')], [ax('setup', ['SINGLE', 'DOUBLE']), ax('mount', ['WALL', 'CEILING'])]))],
        [['Setup', 'Bracket Projection', 'Pole length', 'Left End Treatment'].map((x, i) => (i === 0 ? 'Single or Double' : x)), ['Rod Setup', 'Left End Treatment', 'Pole length']]);
    // the plate travels with the arm that carries it
    const closed = { suppressedBy: 'P-RET', suppressedReason: 'the return carries the rod' };
    eq('behind a return the bracket is not asked, and the plate is chosen on the END step', walked(mini([sl('ROD'), sl('END', 'LEFT'), sl('BRACKET', 'LEFT', closed), sl('BACKPLATE', 'LEFT')])), ['Rod', 'Pole length', 'Left End Treatment [+BACKPLATE||LEFT]', 'Left Bracket']);
    eq('a bracket a choice closed never carries the plate — with no end at that position to take it, the plate is a step of its own', walked(mini([sl('ROD'), sl('BRACKET', 'CENTER', closed), sl('BACKPLATE', 'CENTER')])), ['Rod', 'Pole length', 'Center Bracket', 'Center Backplate']);
    eq('on a double the front end claims the shared plate; the back end does not draw it again', walked(mini([sl('ROD', '', { tier: 'FRONT' }), sl('ROD', '', { tier: 'BACK' }), sl('END', 'LEFT', { tier: 'FRONT' }), sl('END', 'LEFT', { tier: 'BACK' }), sl('BACKPLATE', 'LEFT')])),
        ['Front Rod', 'Back Rod', 'Pole length', 'Front Left End Treatment [+BACKPLATE||LEFT]', 'Back Left End Treatment']);
    eq('a plate no arm claimed is a step of its own, when it has something to offer', [walked(mini([sl('ROD'), sl('BACKPLATE', 'CENTER')])), walked(mini([sl('ROD'), sl('BACKPLATE', 'CENTER', { options: [] })]))], [['Rod', 'Pole length', 'Center Backplate'], ['Rod', 'Pole length']]);
    eq('a slot with nothing to offer is no step — unless a choice closed it (then it is shown, "not asked"); a track end is never a step; nor is one the drive settled',
        [walked(mini([sl('ROD'), sl('END', 'LEFT', { options: [] }), sl('BRACKET', 'LEFT', { options: [], ...closed }), sl('TRV_END', 'LEFT'), sl('TRV_END', 'RIGHT', closed)])), walked(mini([sl('ROD'), sl('END', 'LEFT')]), { settledKeys: new Set(['END||LEFT']) })],
        [['Rod', 'Pole length', 'Left Bracket'], ['Rod', 'Pole length']]);
    // what rides on the rod, and the track's own components
    const carrier = { id: 'CAR-1', partId: 'P-CAR', name: 'Carrier', role: 'CARRIER', qty: 4 }; const clip = { id: 'CLIP-1', partId: 'P-CLIP', name: 'F-clip', role: 'FCLIP' };
    eq('where no ring is asked the carriers are SHOWN in the rings\' place; beside a ring question they are not; nothing rides, no step', [walked(mini([sl('TRACK')], [], [carrier, clip])), walked(mini([sl('TRACK'), sl('RING')], [], [carrier])), walked(mini([sl('TRACK')], [], [clip]))],
        [['Track', 'Pole length', 'Carriers'], ['Track', 'Pole length', 'Ring'], ['Track', 'Pole length']]);
    ok('…and only the carriers are listed on it', walkOf(mini([sl('TRACK')], [], [carrier, clip])).find(st => st.kind === 'CARRIERS').carriers.map(c => c.id).join() === 'CAR-1');
    eq('the track\'s own components are the last step — a track with a chart; never a plain pole, never a track with none', [walked(mini([sl('TRACK')]), { isTraverse: true, trvRules: { usage: [] } }), walked(mini([sl('TRACK')]), { isTraverse: true, trvRules: null }), walked(mini([sl('ROD')]), { isTraverse: false, trvRules: { usage: [] } })],
        [['Track', 'Pole length', 'Traverse components'], ['Track', 'Pole length'], ['Rod', 'Pole length']]);
    ok(`every one of those models walks the same through the screen's old code (${both.length})`, both.length > 15 && both.every(Boolean));
    eq('the track step says where its colour comes from; no other step says anything', [walkOf(mini([sl('TRACK'), sl('ROD'), sl('END', 'LEFT')])).map(st => stepHintOf(st).slice(0, 20)), stepHintOf(null), stepHintOf({ kind: 'LENGTH' })], [['Chosen by the layout', '', '', ''], '', '']);

    // the items offered on a step
    const items = [{ code: 'JNR' }, { code: 'JNR2', step: ' rod length ' }, { code: 'FEE', step: 'track' }, { code: 'CONN', step: 'left bracket (and the right)' }, { code: 'RINGS', step: 'ring' }];
    const onSteps = walkOf(mini([sl('TRACK', '', { tier: 'FRONT' }), sl('BRACKET', 'LEFT'), sl('BRACKET', 'RIGHT'), sl('RING')]));
    eq('an item is offered on the step it names — no step named: the length step; named for the length by another word: the length step; a word of the step\'s name, or the step\'s name within its words',
        onSteps.map(st => [st.label, extrasOnStepOf(items, st).map(it => it.code)]), [['Front Track', ['FEE']], ['Pole length', ['JNR', 'JNR2']], ['Left Bracket', ['CONN']], ['Right Bracket', []], ['Ring', ['RINGS']]]);
    eq('…and none offered, none listed', [extrasOnStepOf(null, onSteps[0]), extrasOnStepOf(items, null).map(it => it.code)], [[], []]);

    // the answer under each heading
    const m1 = mini([sl('ROD'), sl('BRACKET', 'LEFT', closed), sl('END', 'LEFT')], framed);
    const st1 = walkOf(m1, { sizeSteps: [{ id: 'SIZE-DIA', title: 'Rod Diameter', styleOptions: [{ optId: 'D138', partName: '1-3/8"' }, { optId: 'D1', label: 'One inch' }, { optId: 'D75' }] }], isTraverse: true, trvRules: { usage: [{ itemId: 'CAR-RIP', label: 'Ripplefold' }] } });
    const said = (o) => st1.map(st => stepAnswerOf(st, { answers: {}, livePicks: {}, lengthFeet: null, ourId: (id) => `OUR-${id}`, trvLive: null, trvRules: { usage: [{ itemId: 'CAR-RIP', label: 'Ripplefold' }] }, trvComponents: [1, 2, 3], sizePick: {}, ...o }));
    eq('nothing answered, nothing shown — except a step a choice closed', said({}), ['', '', '', '', '', 'not asked', '', '']);
    eq('answered: the size by its name, the framing answers in one cell, the projection, the rod by OUR number, the length in billed feet, the carrier style and how many components',
        said({ answers: { rodKind: 'TRAVERSE', setup: 'DOUBLE', proj: 3.625 }, livePicks: { 'ROD||': 'ROD--1', 'END||LEFT': 'END-LEFT-2' }, lengthFeet: 9, sizePick: { 'SIZE-DIA': 'D1' }, trvLive: { carrierStyle: 'CAR-RIP' } }),
        ['One inch', 'Traverse · Double', '3-5/8"', 'OUR-P-ROD--1', '9 ft', 'not asked', 'OUR-P-END-LEFT-2', 'Ripplefold · 3']);
    eq('a size option with no name answers by its id; a carrier style the chart does not label by its number; a pick with no number by its name',
        [said({ sizePick: { 'SIZE-DIA': 'D75' } })[0], said({ sizePick: { 'SIZE-DIA': 'D138' } })[0], said({ trvLive: { carrierStyle: 'CAR-X' } })[7], said({ livePicks: { 'ROD||': 'ROD--2' }, ourId: () => '' })[3]], ['D75', '1-3/8"', 'CAR-X · 3', 'Part ROD--2']);
    const cSteps = walkOf(mini([sl('TRACK')], [], [{ ...carrier, perFoot: 4 }, { id: 'CAR-2', role: 'CARRIER', partId: 'P-CAR2', qty: 0 }]));
    const carriersSaid = (lengthFeet) => stepAnswerOf(cSteps.find(st => st.kind === 'CARRIERS'), { answers: {}, livePicks: {}, lengthFeet, ourId: (id) => id, trvLive: null, trvRules: null, trvComponents: [], sizePick: {} });
    eq('the carriers answer with how many the length works out to — each rider at its chart count, else its own, else one', carriersSaid(null), `${(recommendedQty({ ...carrier, perFoot: 4 }, null) || 4) + (recommendedQty({ id: 'CAR-2', role: 'CARRIER', qty: 0 }, null) || 1)} included`);
    ok('…every answer the same through the screen\'s old code', [{}, { answers: { rodKind: 'TRAVERSE', setup: 'DOUBLE', proj: 6 }, livePicks: { 'ROD||': 'ROD--1' }, lengthFeet: 12, sizePick: { 'SIZE-DIA': 'D138' }, trvLive: { carrierStyle: 'CAR-RIP' } }, { trvLive: { carrierStyle: 'NOPE' }, sizePick: { 'SIZE-DIA': 'D75' } }].every(o => {
        const env = { answers: {}, livePicks: {}, lengthFeet: null, lengthInches: null, ourId: (id) => `OUR-${id}`, trvLive: null, trvRules: { usage: [{ itemId: 'CAR-RIP', label: 'Ripplefold' }] }, trvComponents: [1, 2, 3], sizePick: {}, ...o };
        const w = oldWalk({ model: m1, settledKeys: new Set(), isTraverse: true, sizeSteps: [{ id: 'SIZE-DIA', title: 'Rod Diameter', styleOptions: [{ optId: 'D138', partName: '1-3/8"' }, { optId: 'D1', label: 'One inch' }, { optId: 'D75' }] }], sizeProjInches: null, offeredExtraItems: [], resolved: { visible: new Set(), clear: new Set(), slots: m1.slots }, extras: [], spliceCodes: [], drawnSplices: [], quantities: {}, ...env });
        return canon(w.steps.map(st => w.answerOf(st))) === canon(st1.map(st => stepAnswerOf(st, env)));
    }));

    // what is drawn
    const res = { visible: new Set(['Rod_L', 'Rod_C', 'BKT_C', 'Plate_C', 'Clip_Strip']), clear: new Set(['Acrylic_Ball']), slots: [] };
    eq('what is drawn is the nodes chosen, keyed in lower case — and the clear parts with them', [visibleOverridesOf(res), clearListOf(res)], [{ rod_l: true, rod_c: true, bkt_c: true, plate_c: true, clip_strip: true }, ['acrylic_ball']]);
    const rodModel = { choices: [{ id: 'R1', role: 'ROD', nodes: ['Rod_L', 'Rod_C', 'Rod_R'] }, { id: 'R2', role: 'FASCIA', nodes: ['Rod_C'] }, { id: 'F1', role: 'FCLIP', nodes: ['Clip_Strip'] }, { id: 'C1', role: 'CARRIER', nodes: ['Car_1'] }, { id: 'B1', role: 'BRACKET', nodes: ['BKT_C'] }], riders: [{ id: 'C1' }] };
    eq('the rail is every rod piece the render shows, once, and the F-clip strip that runs its length — never a piece a return took off, never a carrier', railNamesOf(res, rodModel), ['Rod_L', 'Rod_C', 'Clip_Strip']);
    eq('a long order renders long — only with a length, and a rail to stretch', [stretchSpecOf(['Rod_C'], 144.5), stretchSpecOf(['Rod_C'], 0), stretchSpecOf(['Rod_C'], null), stretchSpecOf([], 144)], [{ railNames: ['Rod_C'], lengthInches: 144.5 }, null, null, null]);
    // (the lines are the pole's SPLICES — spliceInfoOf, the count its brackets are placed by — never one per joiner: 2026-10-20)
    const { spliceInfoOf: spliceOf } = S;
    const marks = (extras, drawn, L, over = 0, trv = 0) => spliceMarksOf({ splice: spliceOf({ extras, spliceCodes: ['JNR'], trvJoiners: trv, drawnSplices: drawn, lengthInches: L, spliceOverIn: over }), drawnSplices: drawn, lengthInches: L }).map(m => Math.round(m.frac * 1000) / 1000);
    eq('a splice is a pencil line, one per SPLICE: one joiner, one at the centre; a double rod\'s two joiners (and a third typed on another row) on a pole one splice makes, still one; a pole made in three pieces, two; the traverse\'s ticked joiner, one; none on the line, none drawn; another item draws nothing',
        [marks([{ code: 'JNR', qty: '1' }], [], 144), marks([{ code: 'JNR', qty: '2' }, { code: 'JNR', qty: 1, slot: 'x' }], [], 144), marks([{ code: 'JNR', qty: '2' }], [], 144, 120), marks([{ code: 'JNR', qty: '1' }], [], 300, 120),
         marks([], [], 144, 120, 1), marks([{ code: 'JNR', qty: '0' }], [{ distInches: 30 }], 144), marks([{ code: 'RING', qty: '5' }], [], 144)],
        [[0.5], [0.5], [0.5], [0.333, 0.667], [0.5], [], []]);
    eq('…and a splice line is where the bracket rule puts a bracket: the same count (centreCountForSplices rounds the centre brackets to it)',
        [spliceOf({ extras: [{ code: 'JNR', qty: '2' }], spliceCodes: ['JNR'], lengthInches: 144, spliceOverIn: 120 }).count, spliceOf({ extras: [{ code: 'JNR', qty: '1' }], spliceCodes: ['JNR'], lengthInches: 300, spliceOverIn: 120 }).count], [1, 2]);
    eq('…where a drawing placed them: from the left edge, from the right ("end" in any case), never off the pole, one with no place left out — and with no length they are spread, one per splice',
        [marks([{ code: 'JNR', qty: '2' }], [{ distInches: 36, ref: '' }, { distInches: 36, ref: 'end' }], 144), marks([{ code: 'JNR', qty: '1' }], [{ distInches: 1, ref: '' }, { distInches: 9999, ref: 'START' }, { distInches: null }, null], 144), marks([{ code: 'JNR', qty: '2' }], [{ distInches: 36 }], 0)],
        [[0.25, 0.75], [0.02, 0.98], [0.5]]);
    const armO = opt('ARM-C'), plateO = opt('PLT-C'), bare = opt('ARM-BARE', { nodes: [] });
    const cRes = (slots) => ({ slots });
    const clones = (slots, picks, q = {}) => cloneSpecsOf({ resolved: cRes(slots), railNames: ['Rod_C'], livePicks: picks, quantities: q });
    const cSlots = [{ kind: 'BRACKET', key: 'B|L', position: 'LEFT', options: [armO] }, { kind: 'BRACKET', key: 'B|C', position: 'center', options: [armO, bare] }, { kind: 'BACKPLATE', key: 'P|L', position: 'LEFT', options: [plateO] }, { kind: 'BACKPLATE', key: 'P|C', position: 'CENTER', options: [plateO] }];
    eq('N centre brackets render as N: the centre arm and ITS plate are the meshes, the arm alone the anchor, the count what the order holds (1 if none) — never a side bracket, never an arm that owns no geometry',
        [clones(cSlots, { 'B|L': 'ARM-C', 'B|C': 'ARM-C', 'P|C': 'PLT-C', 'P|L': 'PLT-C' }, { 'ARM-C': '3' }), clones(cSlots, { 'B|C': 'ARM-C' }), clones(cSlots, { 'B|C': 'ARM-BARE' }), clones(cSlots, { 'B|L': 'ARM-C' })],
        [[{ stepId: 'B|C', meshNames: ['ARM-C_Mesh', 'PLT-C_Mesh'], anchorNames: ['ARM-C_Mesh'], railNames: ['Rod_C'], count: 3 }], [{ stepId: 'B|C', meshNames: ['ARM-C_Mesh'], anchorNames: ['ARM-C_Mesh'], railNames: ['Rod_C'], count: 1 }], [], []]);
    eq('the parts on the order are what was picked and what rides on the rod', chosenPartsOf({ choices: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], riders: [{ id: 'R' }] }, { x: 'C', y: 'A' }).map(c => c.id), ['A', 'C', 'R']);
    ok('…each of those drawn the same through the screen\'s old code', [[cSlots, { 'B|L': 'ARM-C', 'B|C': 'ARM-C', 'P|C': 'PLT-C' }, { 'ARM-C': 4 }], [cSlots, { 'B|C': 'ARM-BARE' }, {}], [cSlots, {}, {}]].every(([slots, picks, q]) => {
        const r2 = { visible: res.visible, clear: res.clear, slots };
        const w = oldWalk({ model: { ...rodModel, axes: [], slots: [] }, settledKeys: new Set(), isTraverse: false, trvRules: null, sizeSteps: [], sizeProjInches: null, answers: {}, livePicks: picks, lengthFeet: 12, lengthInches: 144, ourId: (id) => id, trvLive: null, trvComponents: [], sizePick: {},
            offeredExtraItems: [], resolved: r2, extras: [{ code: 'JNR', qty: '2' }], spliceCodes: ['JNR'], drawnSplices: [{ distInches: 20, ref: 'END' }], quantities: q });
        const rails = railNamesOf(r2, rodModel);
        return canon([w.visibleOverrides, w.clearList, w.railNames, w.stretchSpec, w.spliceMarks, w.cloneSpecs, w.chosen]) === canon([visibleOverridesOf(r2), clearListOf(r2), rails, stretchSpecOf(rails, 144), spliceMarksOf({ splice: spliceOf({ extras: [{ code: 'JNR', qty: '2' }], spliceCodes: ['JNR'], drawnSplices: [{ distInches: 20, ref: 'END' }], lengthInches: 144 }), drawnSplices: [{ distInches: 20, ref: 'END' }], lengthInches: 144 }),
            cloneSpecsOf({ resolved: r2, railNames: rails, livePicks: picks, quantities: q }), chosenPartsOf({ ...rodModel, axes: [], slots: [] }, picks)]);
    }));
    eq('a saved order re-renders from the frozen render alone: additive (default hidden), its clear parts with it — and with no model there is none',
        [renderStateOf({ cadUrl: 'm.glb', textureOverrides: { rod_c: 'tex.png' }, visibleOverrides: { rod_c: true }, cloneSpecs: [1], stretchSpec: null, spliceMarks: [{ frac: 0.5 }], clearList: ['ball'] }), renderStateOf({ cadUrl: '', textureOverrides: {}, visibleOverrides: {}, cloneSpecs: [], stretchSpec: null, spliceMarks: [], clearList: [] })],
        [{ cadUrl: 'm.glb', textureEntries: [{ target: 'rod_c', url: 'tex.png' }], visibilityEntries: [{ target: 'rod_c', visible: true }], cloneSpecs: [1], stretchSpec: null, spliceMarks: [{ frac: 0.5 }], defaultHidden: true, clearNodes: ['ball'] }, null]);

    // the refusals at Add, in order
    eq('how many of this exact configuration: a whole number, never less than one', ['', '0', '1', '3', '-2', 'abc', 2.9, null, undefined, '12 ft'].map(configQtyOf), [1, 1, 1, 3, 1, 1, 2, 1, 1, 12]);
    eq('the one sentence a removal says', [dropRefusalOf([]), dropRefusalOf([{}]).split(' — ')[0], dropRefusalOf([{}, {}]).split(' — ')[0]], ['', '1 selection was removed by a later choice', '2 selections were removed by a later choice']);
    const wood = { id: 'W1', name: 'Wood finial', partId: 'P-W1', materials: ['WOOD'] };
    const asking = [{ code: 'LBR', finish: { code: 'LBR', name: ' Solid brass ', questions: [{ label: 'Surface', choices: ['Brushed', 'Polished'] }] }, questions: [{ label: 'Surface', choices: ['Brushed', 'Polished'] }] }];
    const refusal = (o) => { const r = addRefusalOf({ priced: { lines: [1] }, pendingDrops: [], chosenList: [], finishFor: () => 'S04', askingFinishes: [], finishAnswers: {}, ...o }); return r ? [r.kind, r.alert ? r.alert.split(' — ')[0] : null] : null; };
    eq('Add waits — nothing priced first, then a removal nobody acknowledged (both in silence: the button and the strip already say why), then bare wood, then a finish question still open; else it does not wait',
        [refusal({ priced: { lines: [] }, pendingDrops: [{}], chosenList: [wood], finishFor: () => '' }), refusal({ pendingDrops: [{}], chosenList: [wood], finishFor: () => '' }), refusal({ chosenList: [wood], finishFor: () => '', askingFinishes: asking }), refusal({ chosenList: [wood], askingFinishes: asking }), refusal({ chosenList: [wood], askingFinishes: asking, finishAnswers: { LBR: { Surface: 'Polished' } } })],
        [['NOTHING_PRICED', null], ['REMOVALS', null], ['BARE_WOOD', 'Pick the WOOD finish first'], ['FINISH_QUESTIONS', 'Answer the finish questions first'], null]);
    eq('…and each says what the screen said, naming the parts and the questions', [addRefusalOf({ priced: { lines: [1] }, pendingDrops: [{}, {}], chosenList: [], finishFor: () => '', askingFinishes: [], finishAnswers: {} }).message, addRefusalOf({ priced: { lines: [1] }, pendingDrops: [], chosenList: [wood, { ...wood, id: 'W2', name: '', partId: 'P-W2' }], finishFor: () => '', askingFinishes: [], finishAnswers: {} }).alert, addRefusalOf({ priced: { lines: [1] }, pendingDrops: [], chosenList: [], finishFor: () => '', askingFinishes: asking, finishAnswers: {} }).alert],
        [dropRefusalOf([{}, {}]), 'Pick the WOOD finish first — Wood finial, P-W2 would leave here with no stain.\n\nChoose it on the WOOD row of the finish step, or on the part itself.', 'Answer the finish questions first — LBR (Solid brass): Surface.\n\nThey are at the top of the finish panel and apply to the whole configuration.']);
    eq('an item typed to nothing is not billed — and the same item on two steps is taken or left step by step', takenExtraLinesOf([{ partId: 'FEE', slot: 'T|F' }, { partId: 'FEE', slot: 'B|L' }, { partId: 'JNR' }, { partId: 'GONE' }], [{ code: 'FEE', qty: '0', slot: 'T|F' }, { code: 'FEE', qty: '1', slot: 'B|L' }, { code: 'JNR', qty: '2' }]).map(l => `${l.partId}@${l.slot || ''}`), ['FEE@B|L', 'JNR@']);
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
    // move 6 — the walk and the cart line, from the one call
    eq('sessionOf walks a sized flow: the size questions first, each answered by its option\'s name — the matrix\'s projection is the only projection question',
        [sized.steps.map(st => st.label), sized.steps.map(st => sized.answerOf(st)), sized.refusal.kind, sized.item], [['Rod Diameter', 'Bracket Projection', 'Rod', 'Pole length', 'Left End Treatment', 'Left Bracket'], ['1-3/8" Round Rod', '6" Projection', '', '', '', ''], 'NOTHING_PRICED', null]);
    const sRod = sized.model.slots.find(x => x.kind === 'ROD'), sEnd = sized.model.slots.find(x => x.kind === 'END');
    const lineOf = (state) => sessionOf({ assembly: { ...SIZE_ASM, manufacturingSpecs: { cadUrl: 'https://models.test/h2.glb' } }, pins: SIZE_PINS, parts: sizeParts, flow: SIZE_FLOW },
        { answers: {}, picks: { [sRod.key]: sRod.options[0].id, [sEnd.key]: sEnd.options[0].id }, sizePick: { 'SIZE-DIA': 'SIZE-DIA-138', 'SIZE-PROJ': 'SIZE-PROJ-6' }, lengthInches: 96, ...state });
    const made = lineOf({ qty: '2', memo: 'Den', stepNotes: { length: ' cut  square ', 'gone:step': 'typed earlier' }, stepNoteClient: { length: true } });
    eq('sessionOf builds the cart line CPQ would write: the tag engine\'s, the multiplier, the memo, the parts at the size chosen, what the shop is told and what the customer is shown, the ticks kept for Edit',
        [made.refusal, made.item.engine, made.item.qty, made.item.sidemark, made.item.pricingBreakdown.map(l => `${l.legacyErpId}×${l.qty}`), made.item.generalNotes, made.item.clientNotes, made.item.engineConfig.stepNoteClient, made.item.engineConfig.lengthInches, Object.keys(made.item.engineConfig.picks).length],
        [null, 'TAGS', 2, 'Den', ['H2-138R×1', 'H2-138F×1'], ['Pole length: cut square', 'gone:step: typed earlier'], ['Pole length: cut square'], { length: true }, 96, 2]);
    eq('…with the frozen render the floors redraw it from — additive, the nodes of what was chosen', [made.item.renderState.cadUrl, made.item.renderState.defaultHidden, made.item.renderState.visibilityEntries.map(e => e.target).sort(), made.item.renderState.stretchSpec && made.item.renderState.stretchSpec.lengthInches],
        ['https://models.test/h2.glb', true, ['c-fl_mesh', 'c-rod_mesh'], 96]);
    eq('…a line with nothing to say carries no notes; a saved sidemark is the memo of a line that has none; a multiplier that is no number is one build', [lineOf({}).item.generalNotes, lineOf({}).item.clientNotes, lineOf({}).item.engineConfig.stepNoteClient, lineOf({ sidemark: 'From the drawing' }).item.sidemark, lineOf({ memo: 'Den', sidemark: 'x' }).item.sidemark, lineOf({ qty: 'two' }).item.qty],
        [undefined, undefined, undefined, 'From the drawing', 'Den', 1]);
    eq('…and which part each pick was, beside the picks (so a reopen can name a part whose pin has since been re-made)', made.item.engineConfig.pickParts,
        { [sRod.key]: { partId: 'ID-H2-138R', code: 'H2-138R', name: 'H2-138R' }, [sEnd.key]: { partId: 'ID-H2-138F', code: 'H2-138F', name: 'H2-138F' } });
    eq('pickPartsOf: nothing picked, nothing recorded; a pick that is no choice is left out', [pickPartsOf({}, sized.model.choices, sizeFind), pickPartsOf({ [sRod.key]: 'NOPE', [sEnd.key]: '' }, sized.model.choices, sizeFind)], [{}, {}]);
    // WHAT THE SPAN DEPENDS ON (2026-10-19) — asked, worked into the recommendation, kept on the line, read back by a reopen
    const spanned = lineOf({ fabricId: 'BLACKOUT', dropFt: 12, onStud: false });
    eq('the fabric, the curtain length and the stud answer are on the session and on the saved line — the ones that differ from the default',
        [spanned.span, spanned.item.engineConfig.fabricId, spanned.item.engineConfig.dropFt, spanned.item.engineConfig.onStud], [{ fabricId: 'BLACKOUT', dropFt: 12, onStud: false }, 'BLACKOUT', 12, false]);
    eq('…a line at the defaults saves no fabric and no curtain length (it reopens to them) — and ALWAYS its wall fixing, so a line saved before 2026-10-19 (none on it) reopens in a stud, as it was worked',
        [['fabricId', 'dropFt'].map(k => Object.prototype.hasOwnProperty.call(lineOf({}).item.engineConfig, k)), lineOf({}).item.engineConfig.onStud, lineOf({ onStud: false }).item.engineConfig.onStud], [[false, false], true, false]);
    const reopened = sessionOf({ assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow: SIZE_FLOW, spanMap: { 'H2-1.375': 'H2-138R' } },
        { ...spanned.item.engineConfig, sizePick: { 'SIZE-DIA': 'SIZE-DIA-138', 'SIZE-PROJ': 'SIZE-PROJ-6' } });
    eq('…and a reopen of that line works the span from them again: not into studs, 12 ft of blackout', [reopened.span, reopened.advice && reopened.advice.supports, reopened.advice && reopened.advice.bracketsNoStud],
        [{ fabricId: 'BLACKOUT', dropFt: 12, onStud: false }, 4, 4]);
    // a saved pick that is not among the choices any more is NAMED, and the add waits
    const acrylic = sized.model.slots.find(x => x.kind === 'END').options.find(o => /138AF/.test(o.id));
    const sizeData = { assembly: SIZE_ASM, pins: SIZE_PINS, parts: sizeParts, flow: SIZE_FLOW };
    const atHalf = (state) => sessionOf(sizeData, { answers: {}, picks: { [sRod.key]: sRod.options[0].id, [sEnd.key]: acrylic.id }, sizePick: { 'SIZE-DIA': 'SIZE-DIA-05', 'SIZE-PROJ': 'SIZE-PROJ-6' }, lengthInches: 96, ...state });
    const half = atHalf({});
    eq('a part picked at one diameter and not made at the next is named, with why — and Add waits for it', [half.livePicks[sEnd.key], half.pendingDrops.map(d => [d.step, d.partCode, d.reason]), half.refusal.kind, half.item], [undefined, [['Left End Treatment', acrylic.partId, 'not made in the size now chosen']], 'REMOVALS', null]);
    const halfAcked = atHalf({ drops: half.drops.map(d => ({ ...d, acked: true })) });
    ok('…acknowledged, the line is built without it', halfAcked.refusal === null && !!halfAcked.item && !halfAcked.item.engineConfig.picks[sEnd.key] && halfAcked.item.pricingBreakdown.every(l => !/AF$/.test(l.legacyErpId)));
    const gonePin = (state) => sessionOf(sizeData, { answers: {}, picks: { [sRod.key]: sRod.options[0].id, [sEnd.key]: 'PIN-RE-MADE-SINCE' }, sizePick: { 'SIZE-DIA': 'SIZE-DIA-138', 'SIZE-PROJ': 'SIZE-PROJ-6' }, lengthInches: 96, ...state });
    eq('a pick whose pin is no longer on the assembly is named by its step — by the part where the line recorded it', [gonePin({}).pendingDrops.map(d => [d.step, d.partName, d.partCode]), gonePin({ pickParts: { [sEnd.key]: { partId: 'ID-OLD', code: 'H2-138XF', name: 'Old finial' } } }).pendingDrops.map(d => [d.step, d.partName, d.partCode]), gonePin({}).refusal.kind],
        [[['Left End Treatment', 'the part saved on this line', '']], [['Left End Treatment', 'Old finial', 'H2-138XF']], 'REMOVALS']);
    eq('everyChoiceOf is every choice the assembly pins, whatever the size chosen', [everyChoiceOf(SIZE_ASM, SIZE_PINS).length, half.everyChoice.length, half.choices.length < half.everyChoice.length], [SIZE_PINS.length, SIZE_PINS.length, true]);
    // the parts of one framing with the answers of the next: a later answer removes some of them
    const staleData = { assembly: ASSEMBLY, pins: PINS, parts: [], finishes: FIN };
    const staleState = framings.map((a, i) => ({ answers: framings[(i + 1) % framings.length], picks: picksFor(a, `stale|${i}`), lengthInches: 96, globalFinishes: { METAL: 'P14', WOOD: 'S04' } }))
        .find(st => { const x = sessionOf(staleData, st); return x.pendingDrops.length > 0 && x.priced.lines.length > 0; });
    const before = sessionOf(staleData, staleState);
    const acked = sessionOf(staleData, { ...staleState, drops: before.drops.map(d => ({ ...d, acked: true })) });
    ok('sessionOf names what a later choice removed and refuses the add until each is acknowledged — handed back acknowledged, the line is built', before.refusal.kind === 'REMOVALS' && before.item === null && before.refusal.message === before.dropRefusal && /removed by a later choice/.test(before.dropRefusal)
        && before.pendingDrops.every(d => typeof d.step === 'string' && d.step.length > 2 && !d.step.includes('|')) && acked.pendingDrops.length === 0 && acked.drops.length === before.drops.length && acked.refusal === null && !!acked.item && acked.dropRefusal === '');
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
