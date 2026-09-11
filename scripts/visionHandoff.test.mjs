// Harness for Shared/visionHandoff — CPQ → Vision, and a re-save that replaces rather than adds.
//   node scripts/visionHandoff.test.mjs
import { draftFromCartLine, cartLineForDraft } from '../src/components/Shared/visionHandoff.js';
import { visionPartIds } from '../src/components/Shared/visionBridge.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

const LINE = { id: 'CART-1', engine: 'TAGS', sidemark: 'Living Room', assemblyId: 'CE-ASM-1786572226393', flowId: 'FLOW-1786821090240', lengthInches: 96,
    engineConfig: { answers: { rodKind: 'SOLID', setup: 'SINGLE', proj: 6, mount: 'WALL' }, lengthInches: 96,
        picks: { 'ROD|FRONT|': 'PIN-R', 'END|FRONT|LEFT': 'PIN-MTR-L', 'BRACKET||RIGHT': 'PIN-BK-R', 'BACKPLATE||RIGHT': 'PIN-PL-R' } } };
{
    const d = draftFromCartLine(LINE, { quoteId: 'QUOTE-1', customerId: 'CUST-4720', jobName: 'Entry', brandId: 'ce', by: 'stuart', now: 1000 });
    eq('the draft is keyed to the line, the quote and the flow', [d.id, d.masterQuoteId, d.cartItemId, d.flowId, d.status], ['DRAFT-CART-1', 'QUOTE-1', 'CART-1', 'FLOW-1786821090240', 'DRAFT_FROM_CPQ']);
    eq('framing rides both specs and the board', [d.specs.rodKind, d.specs.setup, d.spatialData.rodKind, d.spatialData.setup], ['SOLID', 'SINGLE', 'SOLID', 'SINGLE']);
    eq('the ordered length is the board\'s wall B, the projection its proj', [d.spatialData.w2, d.spatialData.proj, d.spatialData.shape], [96, 6, 'STRAIGHT']);
    eq('the engine picks travel by slot, kind and position', d.specs.enginePicks.map(p => [p.slotKey, p.choiceId, p.kind, p.position, p.tier]),
        [['ROD|FRONT|', 'PIN-R', 'ROD', '', 'FRONT'], ['END|FRONT|LEFT', 'PIN-MTR-L', '', 'LEFT', 'FRONT'], ['BRACKET||RIGHT', 'PIN-BK-R', 'BRACKET', 'RIGHT', ''], ['BACKPLATE||RIGHT', 'PIN-PL-R', 'BACKPLATE', 'RIGHT', '']]);
    ok('a line that already has a draft keeps its id', draftFromCartLine({ ...LINE, visionDraftId: 'DRAFT-OLD' }, { quoteId: 'Q' }).id === 'DRAFT-OLD');
    eq('an old-engine line makes no draft', draftFromCartLine({ id: 'X', engine: 'OLD' }, { quoteId: 'Q' }), null);
    eq('"No Sidemark" is not a sidemark', draftFromCartLine({ ...LINE, sidemark: 'No Sidemark', memo: 'Den' }, { quoteId: 'Q' }).sidemark, 'Den');
    ok('the bridge reads nothing from partId-less picks but does not choke (Vision\'s own save fills partId)', Array.isArray(visionPartIds(d, null)));
}
{
    const cart = [{ id: 'CART-1', visionDraftId: 'DRAFT-CART-1' }, { id: 'CART-2' }];
    eq('a re-saved draft finds its line by the line\'s memory', cartLineForDraft(cart, { id: 'DRAFT-CART-1' }).id, 'CART-1');
    eq('…or by the draft\'s memory of the line', cartLineForDraft(cart, { id: 'DRAFT-X', cartItemId: 'CART-2' }).id, 'CART-2');
    eq('a fresh Vision draft matches no line (it ADDS, as it always did)', cartLineForDraft(cart, { id: 'DRAFT-NEW' }), null);
}
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
