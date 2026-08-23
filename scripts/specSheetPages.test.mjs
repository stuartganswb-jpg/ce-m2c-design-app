// The spec sheet's PAGE LIST — the CPQ's own narrowing, one page per leaf.
//   node scripts/specSheetPages.test.mjs
//
// The old list crossed every arm with every plate FAMILY, where "family" was the part code with
// its shape suffix chopped off. Nothing in it read a tag, so nothing in it could be narrowed by
// rod world or projection, and every page showed too much. These assertions exist to prove the
// page list is the engine's answer and not a second opinion.

import {
    narrowings, narrowingLabel, subjectsOf, pageSlots, catalogOf, specPages,
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
const of = (partId, proj) => drawings.find(p =>
    p.subject?.partId === partId && (proj === undefined || p.answers.proj === proj));
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
        plateIds(of('H1-138DS', 3.625)), ['H1-138BP-H', 'H1-138BP-S']);
    eq('the deep arm draws only the deep plate',
        plateIds(of('H1-138DE', 4.625)), ['H1-138BP-SE']);
    ok('a return plate never lands on a plain arm',
        !plateIds(of('H1-138DS', 3.625)).includes('H1-138RBP-S'));
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

// ── RINGS ARE THE RINGS THAT FIT THAT ROD ────────────────────────────────────────────────────
{
    eq('a solid page carries every ring that fits its rod',
        ringIds(of('H1-138DS', 3.625)), ['H1-138BPR', 'H1-138BR']);
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
    const sigs = drawings.map(p => `${p.subject.partId}|${p.answers.rodKind}|${p.answers.proj}`);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
