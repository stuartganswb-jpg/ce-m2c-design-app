// A portal request reopened in CPQ carries what its customer said and the pictures they took (step 5 of the portal rebuild,
// Stuart 2026-10-20: "go on 2").   node scripts/reopenPortalRequest.test.mjs
/* global globalThis */
import { portalRequestMemoOf, reopenQuoteInCpq } from '../src/components/Shared/reopenQuote.js';
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`); };

const SHORT = 'Fewer centre brackets than recommended: 1 chosen, 3 recommended for this 144″ pole on drywall with toggles. The customer confirmed the risk.';
const PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const request = (extra = {}) => ({
    jobId: 'SG102026-1', quoteNo: 'SG102026-1', status: 'PORTAL_REQUEST', source: 'PORTAL', customer: { id: 'CUST-4720', name: 'FABRICUT' }, jobName: 'H1-138 — FABRICUT',
    portalRequest: { kind: 'CONFIG', note: '  Install the week of\nNov 3 —  please call first ', lines: [
        { flowId: 'F1', flowName: 'H1-138', lineTag: 'Living room', notes: [SHORT] },
        { flowId: 'F1', flowName: 'H1-138', lineTag: '' },
        { flowId: 'F2', flowName: 'H1-1', lineTag: 'Den', notes: ['Fewer centre brackets than recommended: none chosen, 1 recommended for this 120″ pole in a stud.'] },
    ] },
    cpqData: { cartItems: [{ id: 'PORTAL-SG102026-1-1', renderSnapshot: PIC, sidemark: 'Living room' }, { id: 'PORTAL-SG102026-1-2', renderSnapshot: null }, { id: 'PORTAL-SG102026-1-3' }] },
    ...extra,
});

// ── THE MEMO ──
eq('an unpriced request: the customer\'s note, then each line\'s notes by its number and tag — on one line', portalRequestMemoOf(request()),
    `Portal request — Customer's note: Install the week of Nov 3 — please call first · Line 1 (Living room): ${SHORT} · Line 3 (Den): Fewer centre brackets than recommended: none chosen, 1 recommended for this 120″ pole in a stud.`);
eq('…no line notes: the note alone', portalRequestMemoOf(request({ portalRequest: { kind: 'CONFIG', note: 'Rush please', lines: [{ flowId: 'F1' }] } })), "Portal request — Customer's note: Rush please");
eq('…no note: the line notes alone', portalRequestMemoOf(request({ portalRequest: { kind: 'CONFIG', note: '', lines: [{ lineTag: 'Hall', notes: ['X.'] }] } })), 'Portal request — Line 1 (Hall): X.');
eq('…nothing said: nothing written', portalRequestMemoOf(request({ portalRequest: { kind: 'CONFIG', note: ' ', lines: [{ notes: [] }, { notes: [' '] }] } })), '');
eq('a request staff have priced (a saved breakdown) is a quote: its own memo is the truth', portalRequestMemoOf(request({ cpqData: { cartItems: [], breakdown: [{ name: 'H1-138', partId: 'P' }] } })), '');
eq('…and so is one CPQ has saved (status CONFIGURED) — a memo staff cleared is never filled again', portalRequestMemoOf(request({ status: 'CONFIGURED' })), '');
eq('a quote that never was a portal request, and nothing at all', [portalRequestMemoOf({ status: 'CONFIGURED', cpqData: {} }), portalRequestMemoOf(null), portalRequestMemoOf({})], ['', '', '']);

// ── THE REOPEN ITSELF (the CRM's and the ERP hub's Reopen CPQ) — what CPQ is handed ──
const store = {};
const events = [];
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
globalThis.alert = (m) => { throw new Error(`alert: ${m}`); };
globalThis.confirm = () => true;
window.confirm = globalThis.confirm;

const opened = (job) => { events.length = 0; const ok = reopenQuoteInCpq(job); return { ok, detail: events[0] && events[0].type === 'REOPEN_QUOTE_IN_CPQ' ? events[0].detail : null }; };
{
    const { ok, detail } = opened(request());
    eq('Reopen CPQ opens an unpriced portal request', ok && !!detail, true);
    eq('…with what the customer said in the internal memo', detail.session.internalMemo, portalRequestMemoOf(request()));
    eq('…every line\'s picture as the customer took it, on the line CPQ keeps it on', detail.cartItems.map((it) => it.renderSnapshot || null), [PIC, null, null]);
    eq('…and every line still belongs to this quote (re-finalize saves in place)', detail.cartItems.map((it) => it.masterQuoteId), ['SG102026-1', 'SG102026-1', 'SG102026-1']);
}
{
    const { detail } = opened(request({ status: 'CONFIGURED', internalMemo: 'Staff: matched to sample', cpqData: { cartItems: [{ id: 'A', renderSnapshot: PIC }], breakdown: [{ name: 'H1-138', partId: 'P' }] } }));
    eq('a priced quote reopens with its own memo, not the customer\'s words again', detail.session.internalMemo, 'Staff: matched to sample');
    eq('…its pictures ride along unchanged', detail.cartItems[0].renderSnapshot, PIC);
}
{
    const { detail } = opened(request({ status: 'CONFIGURED', cpqData: { cartItems: [{ id: 'A' }], breakdown: [{ name: 'H1-138', partId: 'P' }] } }));
    eq('a priced quote whose memo staff left empty reopens empty', detail.session.internalMemo, '');
}
{
    const { detail } = opened(request({ internalMemo: 'Staff: called Nov 1, confirmed colour' }));
    eq('an unpriced request whose memo staff already typed (the CRM\'s ✎ Edit) reopens with theirs', detail.session.internalMemo, 'Staff: called Nov 1, confirmed colour');
}

console.log(`reopenPortalRequest: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
