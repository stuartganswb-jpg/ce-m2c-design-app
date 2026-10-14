// Shared/portalAccess — a product on the portal is Off, on Preview, or Live (Stuart 2026-10-14).
//   node scripts/portalAccess.test.mjs
// …and what a login may open is the same answer on HQ's side and on the portal's server (functions/portalSession.flowIdsFor).
import { createRequire } from 'node:module';
import { FLOW_MODE, flowModeOf, groupModeOf, withFlowMode, withPreviewer, flowIdsForLogin } from '../src/components/Shared/portalAccess.js';
const P = createRequire(import.meta.url)('../functions/portalSession.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

const crm = { portalFlowIds: ['A', 'B'], portalPreviewFlowIds: ['C', 'B'], portalPreviewUids: ['u1'] };
eq('a flow is LIVE, PREVIEW or OFF — live wins when it is on both lists', ['A', 'B', 'C', 'D'].map((id) => flowModeOf(crm, id)), ['LIVE', 'LIVE', 'PREVIEW', 'OFF']);
eq('a size group has one mode when its flows agree, MIXED when not', [groupModeOf(crm, ['A', 'B']), groupModeOf(crm, ['A', 'C']), groupModeOf(crm, ['D']), groupModeOf({}, ['X', 'Y'])], ['LIVE', 'MIXED', 'OFF', 'OFF']);
eq('setting a flow LIVE takes it off preview', withFlowMode(crm, ['C'], FLOW_MODE.LIVE), { portalFlowIds: ['A', 'B', 'C'], portalPreviewFlowIds: [] });
eq('setting a flow to PREVIEW takes it off live', withFlowMode(crm, ['A'], FLOW_MODE.PREVIEW), { portalFlowIds: ['B'], portalPreviewFlowIds: ['C', 'A'] });
eq('OFF takes it off both', withFlowMode(crm, ['B'], FLOW_MODE.OFF), { portalFlowIds: ['A'], portalPreviewFlowIds: ['C'] });
eq('a whole size group at once; every other flow untouched', withFlowMode({ portalFlowIds: ['Z'], portalPreviewFlowIds: [] }, ['G1', 'G2'], FLOW_MODE.PREVIEW), { portalFlowIds: ['Z'], portalPreviewFlowIds: ['G1', 'G2'] });
eq('nothing set yet: the lists start empty', withFlowMode(null, ['A'], FLOW_MODE.LIVE), { portalFlowIds: ['A'], portalPreviewFlowIds: [] });
eq('a login ticked to see previews, unticked, never twice', [withPreviewer(crm, 'u2', true), withPreviewer(crm, 'u1', false), withPreviewer(crm, 'u1', true), withPreviewer(null, 'u3', true), withPreviewer(crm, '', true)], [['u1', 'u2'], [], ['u1'], ['u3'], ['u1']]);
// HQ's answer and the server's, on every combination
const records = [crm, { portalFlowIds: ['A'], portalPreviewFlowIds: ['A', 'C', ''], portalPreviewUids: ['u1', 'u2'] }, {}, null, { portalFlowIds: 'x', portalPreviewFlowIds: [7], portalPreviewUids: 'u1' }];
let same = 0, n = 0;
for (const r of records) for (const uid of ['u1', 'u2', 'u3', '', undefined]) { n++; if (JSON.stringify(flowIdsForLogin(r, uid)) === JSON.stringify(P.flowIdsFor(r, uid))) same++; else console.log('  differ:', JSON.stringify(r), uid); }
eq(`what a login may open is the same answer in HQ and on the portal's server (${same} of ${n})`, same, n);
eq('a previewer sees live + preview; anyone else only live', [flowIdsForLogin(crm, 'u1').all, flowIdsForLogin(crm, 'u9').all], [['A', 'B', 'C'], ['A', 'B']]);
console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
