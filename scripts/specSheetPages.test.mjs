// The spec sheet's PAGE LIST — the CPQ's own narrowing, one page per leaf.
//   node scripts/specSheetPages.test.mjs
//
// The old list crossed every arm with every plate FAMILY, where "family" was the part code with
// its shape suffix chopped off. Nothing in it read a tag, so nothing in it could be narrowed by
// rod world or projection, and every page showed too much. These assertions exist to prove the
// page list is the engine's answer and not a second opinion.

import {
    narrowings, narrowingLabel, subjectsOf, pageSlots, catalogOf, specPages, auditPages,
} from '../src/components/SpecSheet/specSheetPages.js';
import { resolve } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// H1's real shape, reduced: a solid rod and a traverse track in one collection; arms made at two
// projections; a traverse-only arm; the three plate pools; rings; carriers; a french return; a
// finial and an accessory for the catalog page.
const CHOICES = [
    { id: 'ROD', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rod'] },
    { id: 'TRK', partId: 'H1-2TRV', role: 'TRACK', rodKind: 'TRAVERSE', position: 'CENTER', nodes: ['trk'] },

    { id: 'ARM-D-S', partId: 'H1-138DS', role: 'BRACKET', position: 'LEFT', proj: '3.625', nodes: ['ads'] },
    { id: 'ARM-D-E', partId: 'H1-138DE', role: 'BRACKET', position: 'LEFT', proj: '4.625', nodes: ['ade'] },
    { id: 'ARM-B', partId: 'H1-138B', role: 'BRACKET', position: 'LEFT', proj: '3.625', isBasic: true, nodes: ['ab'] },
    { id: 'ARM-TRV', partId: 'H1-2TRVBKT', role: 'BRACKET', position: 'LEFT', fits: ['TRAVERSE'], proj: '3.625', nodes: ['atrv'] },

    { id: 'PL-S', partId: 'H1-138BP-S', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', nodes: ['ps'] },
    { id: 'PL-H', partId: 'H1-138BP-H', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', nodes: ['ph'] },
    { id: 'PL-CS', partId: 'H1-138CP-S', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', nodes: ['pcs'] },
    { id: 'PL-CH', partId: 'H1-138CP-H', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', nodes: ['pch'] },
    { id: 'PL-E', partId: 'H1-138BP-SE', role: 'BACKPLATE', position: 'LEFT', proj: '4.625', nodes: ['pe'] },
    { id: 'PL-RTN', partId: 'H1-138RBP-S', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', returnOnly: true, nodes: ['pr'] },

    { id: 'RING-BR', partId: 'H1-138BR', role: 'RING', nodes: ['rb'] },
    { id: 'RING-BPR', partId: 'H1-138BPR', role: 'RING', nodes: ['rp'] },
    { id: 'CARRIER', partId: 'H1-2TRVC', role: 'CARRIER', rodKind: 'TRAVERSE', nodes: ['car'] },

    { id: 'RTN-FR', partId: 'H1-138RBP', role: 'RETURN', position: 'LEFT', proj: '3.625', usesReturnPlates: true, nodes: ['fr'] },
    { id: 'FIN', partId: 'HNFSBLR138', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] },
    { id: 'ACC', partId: 'H1-HOLDBACK', role: 'ACCESSORY', nodes: ['acc'] },
];

const pages = specPages({ choices: CHOICES });
const drawings = pages.filter(p => p.kind !== 'CATALOG');
const of = (partId, proj, fam) => drawings.find(p =>
    p.subject?.partId === partId && (proj === undefined || p.answers.proj === proj)
    && (fam === undefined || p.plateFamily === fam));
const plateIds = (p) => (p ? p.plates.map(x => x.partId).sort() : null);
const ringIds = (p) => (p ? p.rings.map(x => x.partId).sort() : null);

// ── THE WALK IS THE CPQ'S, NOT A SECOND COPY ─────────────────────────────────────────────────
{
    const leaves = narrowings(resolve({ choices: CHOICES }).choices);
    ok('the walk branches on rod world', leaves.some(l => l.rodKind === 'SOLID') && leaves.some(l => l.rodKind === 'TRAVERSE'));
    ok('and on projection', leaves.some(l => l.proj === 3.625) && leaves.some(l => l.proj === 4.625));
    ok('every leaf is a complete answer set', leaves.every(l => l.rodKind && l.proj));
    const norm = resolve({ choices: CHOICES }).choices;
    ok('a leaf labels itself in the CPQ\'s order', /SOLID/.test(narrowingLabel(norm, { rodKind: 'SOLID', proj: 3.625 })));
}

// ── ONE PAGE = ONE ARM AT ONE PROJECTION ─────────────────────────────────────────────────────
{
    ok('the deep arm gets its own page', !!of('H1-138DE', 4.625));
    ok('the shallow arm gets its own page', !!of('H1-138DS', 3.625));
    ok('and an arm is never listed at a depth it is not made in', !of('H1-138DS', 4.625));
    ok('a page names one subject only', drawings.every(p => !!p.subject));
}

// ── AND THE PLATES ON IT ARE THE ONES THE CPQ WOULD OFFER ────────────────────────────────────
{
    eq('the shallow arm draws only the shallow plates',
        plateIds(of('H1-138DS', 3.625, 'H1-138BP')), ['H1-138BP-H', 'H1-138BP-S']);
    eq('the deep arm draws only the deep plate',
        plateIds(of('H1-138DE', 4.625)), ['H1-138BP-SE']);
    ok('a return plate never lands on a plain arm',
        !drawings.filter(p => p.subject.partId === 'H1-138DS').some(p => plateIds(p).includes('H1-138RBP-S')));
    eq('a basic arm draws alone', plateIds(of('H1-138B', 3.625)), []);
    ok('…and says why', /one piece/.test(of('H1-138B', 3.625).reason || ''));
}

// ── A RETURN DRAWS LIKE A BRACKET, BECAUSE IT MOUNTS LIKE ONE ────────────────────────────────
{
    const fr = of('H1-138RBP');
    ok('the french return gets its own page', !!fr);
    eq('and it is marked as a return', fr.kind, 'RETURN');
    eq('with the RETURN plates, not the plain ones', plateIds(fr), ['H1-138RBP-S']);
}

// ── ONE SHEET PER PLATE FAMILY, AS THE REFERENCE SET IS DRAWN ────────────────────────────────
// Stuart's examples are named "…with screw Backplates" and "…with Hidden Backplates": the same
// arm, drawn once against the BP set and once against the CP set, four profile rows each.
{
    const dsPages = drawings.filter(p => p.subject.partId === 'H1-138DS' && p.answers.proj === 3.625);
    eq('the BP set and the CP set are separate sheets', dsPages.length, 2);
    eq('backplates first', dsPages[0].plateFamily, 'H1-138BP');
    eq('then cover plates', dsPages[1].plateFamily, 'H1-138CP');
    eq('and neither sheet carries the other\'s plates',
        plateIds(dsPages[1]), ['H1-138CP-H', 'H1-138CP-S']);
    ok('rows run in profile order H, R, S, V',
        dsPages[0].plates.map(p => p.partId).join(',') === 'H1-138BP-H,H1-138BP-S');
    ok('an arm with no plates still gets exactly one sheet',
        drawings.filter(p => p.subject.partId === 'H1-138B' && p.answers.proj === 3.625).length === 1);
}

// ── RINGS ARE THE RINGS THAT FIT THAT ROD ────────────────────────────────────────────────────
{
    eq('a solid page carries every ring that fits its rod',
        ringIds(of('H1-138DS', 3.625, 'H1-138BP')), ['H1-138BPR', 'H1-138BR']);
    const trv = of('H1-2TRVBKT');
    ok('the traverse arm gets a page', !!trv);
    eq('a track carries no rings — carriers do that job', ringIds(trv), []);
    ok('and the carriers ride with it', (trv.riders || []).some(r => r.partId === 'H1-2TRVC'));
    ok('the traverse page knows it is one', trv.isTraverse === true);
}

// ── THE WORLDS DO NOT LEAK INTO EACH OTHER ───────────────────────────────────────────────────
{
    const solidPages = drawings.filter(p => p.answers.rodKind === 'SOLID');
    ok('no traverse arm on a solid page', !solidPages.some(p => p.subject.partId === 'H1-2TRVBKT'));
    const trvPages = drawings.filter(p => p.answers.rodKind === 'TRAVERSE');
    ok('no solid arm on a traverse page', !trvPages.some(p => p.subject.partId === 'H1-138DS'));
}

// ── NOTHING IS PRINTED TWICE ─────────────────────────────────────────────────────────────────
{
    const sigs = drawings.map(p => `${p.subject.partId}|${p.answers.rodKind}|${p.answers.proj}|${p.plateFamily}`);
    eq('every drawing page is distinct', sigs.length, new Set(sigs).size);
}

// ── THE CATALOG COMES LAST, AND ONCE ─────────────────────────────────────────────────────────
{
    const cats = pages.filter(p => p.kind === 'CATALOG');
    ok('there is a catalog page', cats.length >= 1);
    ok('it carries the finials', cats[0].finials.some(f => f.partId === 'HNFSBLR138'));
    ok('and the accessories', cats[0].accessories.some(a => a.partId === 'H1-HOLDBACK'));
    const model = resolve({ choices: CHOICES, answers: { rodKind: 'SOLID', proj: 3.625 } });
    eq('catalogOf reads them off the model', catalogOf(model).finials.length, 1);
}

// ── AND NOTHING IS INVENTED WHERE THERE IS NOTHING ───────────────────────────────────────────
{
    eq('no subject, no page content', pageSlots({ choices: [], subject: null }).plates.length, 0);
    const bare = CHOICES.filter(c => c.role === 'ROD' || c.role === 'BRACKET');
    const p = specPages({ choices: bare }).filter(x => x.kind !== 'CATALOG');
    ok('an assembly with no plates still lists its arms', p.length >= 2);
    ok('…drawing them alone', p.every(x => x.plates.length === 0));
    eq('and an assembly with nothing at all lists nothing', specPages({ choices: [] }).length, 0);
    const model = resolve({ choices: CHOICES, answers: { rodKind: 'SOLID', proj: 3.625 } });
    ok('subjectsOf reads arms AND returns off the model',
        subjectsOf(model).some(s => s.kind === 'RETURN') && subjectsOf(model).some(s => s.kind === 'BRACKET'));
}

// ── THE SET IS ITS OWN ASSEMBLY'S, AND SAYS SO ───────────────────────────────────────────────
// Stuart 2026-08-23: "every assembly needs its own to avoid a mess." The audit walks an
// INDEPENDENT path — `judge`, the gate itself, plus the pairing rules in plain form — so a
// disagreement with the builder is a real defect in one of them, not a restatement.
{
    eq('a set the engine built audits clean', auditPages(pages, CHOICES), []);
    eq('and so does an empty one', auditPages([], CHOICES), []);
    ok('a broken engine never takes the tool down', Array.isArray(auditPages(pages, null)));

    const solid = drawings.find(p => p.subject.partId === 'H1-138DS' && p.plateFamily === 'H1-138BP');

    // a plate smuggled in from another depth
    const wrongDepth = [{ ...solid, plates: [...solid.plates, { id: 'PL-E', partId: 'H1-138BP-SE' }] }];
    ok('a plate from another projection is caught',
        auditPages(wrongDepth, CHOICES).some(v => /not admissible/.test(v.why)));

    // a return plate on a plain arm
    const wrongPool = [{ ...solid, plates: [{ id: 'PL-RTN', partId: 'H1-138RBP-S', returnOnly: true }] }];
    ok('a return plate on a plain arm is caught',
        auditPages(wrongPool, CHOICES).some(v => /return plate/.test(v.why)));

    // plates on a one-piece arm
    const basic = drawings.find(p => p.subject.partId === 'H1-138B');
    const basicWithPlate = [{ ...basic, plates: [{ id: 'PL-S', partId: 'H1-138BP-S' }] }];
    ok('a basic arm carrying plates is caught',
        auditPages(basicWithPlate, CHOICES).some(v => /one piece/.test(v.why)));

    // rings hung on a track
    const trv = drawings.find(p => p.isTraverse);
    const ringsOnTrack = [{ ...trv, rings: [{ id: 'RING-BR', partId: 'H1-138BR' }] }];
    ok('rings hung on a track are caught',
        auditPages(ringsOnTrack, CHOICES).some(v => /carriers/.test(v.why)));

    // and the violation names the page and the part, or it is not actionable
    const v = auditPages(wrongPool, CHOICES)[0];
    ok('a violation names its page, subject and part', !!v.page && !!v.subject && !!v.part);
}

// ── REAL PINS CARRY A DOC ID, NOT A CODE ─────────────────────────────────────────────────────
// Prod pins have partId = 'CE-INV-56809' and name = 'H1-138CP-H'. Grouping families on partId made
// every plate its own family — one row per sheet where the reference has four, and 187 sheets.
// Every fixture above uses codes as ids, which is exactly why they all passed while prod did not.
{
    // prod's shape: the CODE is in name, and partId is a library doc id
    const REAL = CHOICES.map((c, i) => (c.role === 'BACKPLATE'
        ? { ...c, name: c.partId, partId: `CE-INV-${1000 + i}` }
        : c));
    const rp = specPages({ choices: REAL }).filter(p => p.kind !== 'CATALOG');
    const ds = rp.filter(p => p.subject.partId === 'H1-138DS' && p.answers.proj === 3.625);
    eq('doc-id pins still make exactly two plate families', ds.length, 2);
    eq('and the family is named by the CODE, not the id', ds[0].plateFamily, 'H1-138BP');
    eq('with all of that family\'s profiles on the one sheet',
        ds[0].plates.map(p => p.name).sort(), ['H1-138BP-H', 'H1-138BP-S']);
    // and the fixture shape — code in partId, name defaulted to the id by normalizeChoice —
    // still groups the same way, because neither field is trusted on its own
    const fx = drawings.filter(p => p.subject.partId === 'H1-138DS' && p.answers.proj === 3.625);
    eq('the fixture shape groups identically', fx.length, 2);
    eq('and names its family by the code too', fx[0].plateFamily, 'H1-138BP');
    ok('no family is ever named by a doc id', rp.every(p => !/^CE-(INV|ASM)-/.test(p.plateFamily || '')));
}

// ── EVERY PAGE'S ROD IS ONE ITS OWN LEAF OFFERS ──────────────────────────────────────────────
// Inside-mount pages picked theirs from the UNJUDGED model — 77 sheets in prod carrying a rod
// their own leaf excludes, found by the audit rather than by a person.
//
// ⚠ THE FIXTURE HAS TO BE ABLE TO FAIL. Two earlier versions of this could not: rods are not gated
// on `mount`, and where the offending rod is not the one rodForArm WOULD pick, judging the pool
// changes nothing. So the bad rod must be the preferred one — here the inside mount is tiered BACK
// and the only BACK rod is the traverse track, which the SOLID leaf excludes. Mutating this back
// to rodForArm(model, im) produces exactly the prod message.
{
    const F = [
        { id: 'ROD-F', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rf'] },
        { id: 'TRK', partId: 'H1-2TRV', role: 'TRACK', rodKind: 'TRAVERSE', position: 'CENTER', tier: 'BACK', nodes: ['trk'] },
        { id: 'ARM-S', partId: 'H1-138DS', role: 'BRACKET', position: 'LEFT', proj: '3.625', nodes: ['as'] },
        { id: 'IM', partId: 'H1-138IM', role: 'INSIDE_MOUNT', position: 'LEFT', tier: 'BACK', nodes: ['im'] },
    ];
    const mp = specPages({ choices: F });
    const im = mp.find(p => p.kind === 'INSIDE_MOUNT');
    ok('an inside-mount sheet is among the pages', !!im);
    eq('and it takes a rod its own leaf offers', im.rod?.partId, 'H1-138R');
    eq('so nothing on the set carries a rod it should not', auditPages(mp, F).filter(v => /rod/.test(v.why)), []);
}

// ── AN AUDIT THAT CRIES WOLF IS WORSE THAN NO AUDIT ──────────────────────────────────────────
// The first cut reported 76 false alarms on 19 prod sheets: it tested `arm.inlineOnly`, a flag
// PLATES carry and arms do not — the engine keys on `arm.isInline` (which normalizeChoice derives
// from usesReturnPlates). It also called a plain plate on an in-line arm a fault, when the engine
// deliberately falls back to the plain pool for a return that has no other copies.
{
    const INL = [
        { id: 'ROD', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['r'] },
        { id: 'ARM-IL', partId: 'H1-138ILS', role: 'BRACKET', position: 'LEFT', proj: '3.625', usesReturnPlates: true, nodes: ['ail'] },
        { id: 'ARM-PLAIN', partId: 'H1-138DS', role: 'BRACKET', position: 'LEFT', proj: '3.625', nodes: ['ad'] },
        { id: 'PL-INL', partId: 'H1-138BP-INL', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', inlineOnly: true, nodes: ['pi'] },
        { id: 'PL-PLAIN', partId: 'H1-138BP-S', role: 'BACKPLATE', position: 'LEFT', proj: '3.625', nodes: ['pp'] },
    ];
    const ip = specPages({ choices: INL });
    const il = ip.find(p => p.subject?.partId === 'H1-138ILS');
    ok('the in-line arm gets its in-line plate', plateIds(il).includes('H1-138BP-INL'));
    eq('and the audit does NOT call that a fault', auditPages(ip, INL), []);
    // the rule still bites where it should: an in-line plate under an ordinary wall bracket
    const plain = ip.find(p => p.subject?.partId === 'H1-138DS');
    const smuggled = [{ ...plain, plates: [{ id: 'PL-INL', partId: 'H1-138BP-INL', inlineOnly: true }] }];
    ok('but an in-line plate on an ordinary bracket still is',
        auditPages(smuggled, INL).some(v => /ordinary wall bracket/.test(v.why)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
