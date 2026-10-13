// ── DOES THE PORTAL'S SERVER WORK A CONFIGURATION OUT AS HQ DOES? (the portal rebuild, step 3 — 2026-10-13) ──
//
// The portal's Cloud Functions run a COPY of this engine and read the library, the pins and the finishes
// themselves (functions/portalSession.js). No script can read production, so the proof that the server reads
// what CPQ reads is made here, in the signed-in app: CPQ works a set of configurations of the flow that is
// open — every framing the assembly offers, two ways through its parts — hands the SAME answers to the server
// (portalConfigCheck), and holds the cart line each side built against the other, row for row.
//
// Pure: what to ask, what HQ answers, and how the two are compared. The call itself is CPQTab's.
// Harness: scripts/portalCheck.test.mjs.
import { sessionOf } from './hardwareSession.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// The answers a customer can give on the portal, and nothing else — so the server takes them exactly as sent
// (functions/portalSession.stateFromClient drops or refuses the rest).
const asSent = (st) => ({ answers: st.answers || {}, picks: st.picks || {}, lengthInches: st.lengthInches || null, globalFinishes: st.globalFinishes || {}, qty: 1 });
// …and the same configuration as the server completes it before working it out.
const asWorked = (st) => ({ ...asSent(st), sizePick: {}, stepQty: {}, fabricId: 'PRINT', partFinish: {}, finishAnswers: {}, memo: '', drops: [],
    extras: [], spliceWaived: false, kitPick: '', kitCode: '', kitMotor: '', trvSel: null, stepNotes: {}, stepNoteClient: {} });

/**
 * The configurations to ask about: every framing (each open question answered each way), and for each the first
 * part every step offers and the last — at two lengths (one over the usual one-piece limit), in the first paint
 * and the first stain the flow offers. Never a finish of another material (solid brass is not on the portal).
 */
export function checkStatesOf(data, { max = 40 } = {}) {
    const open = (state) => sessionOf({ ...data, kits: [], priceLevel: 'STANDARD' }, asWorked(state));
    const framings = [];
    (function walk(answers) {
        if (framings.length >= max) return;
        const next = open({ answers, picks: {} }).model.axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null);
        if (!next) { framings.push(answers); return; }
        next.values.forEach(v => walk({ ...answers, [next.key]: v }));
    })({});
    const finishes = open({ answers: framings[0] || {}, picks: {} }).offeredFinishes || [];
    const first = (material) => { const f = finishes.find(x => U(x.material || x.type || 'METAL') === material && x.code); return f ? U(f.code) : ''; };
    const globalFinishes = { ...(first('METAL') ? { METAL: first('METAL') } : {}), ...(first('WOOD') ? { WOOD: first('WOOD') } : {}) };
    const out = [];
    framings.forEach((answers, fi) => {
        [0, 1].forEach((way) => {
            if (out.length >= max) return;
            let picks = {};
            for (let guard = 0; guard < 60; guard++) {
                const have = picks;
                const s = open({ answers, picks: have });
                const slot = s.model.slots.find(x => !s.livePicks[x.key] && !have[x.key] && x.options.length && !x.suppressedBy);
                if (!slot) break;
                picks = { ...have, [slot.key]: slot.options[way === 0 ? 0 : slot.options.length - 1].id };
            }
            out.push(asSent({ answers, picks, lengthInches: (fi + way) % 2 ? 150 : 96, globalFinishes }));
        });
    });
    return out;
}

/** What HQ's own engine answers for one of them, for this customer at their own level — the shape the server answers in. */
export function mineOf(data, state) {
    const s = sessionOf({ ...data, kits: [], priceLevel: 'STANDARD' }, asWorked(state));
    if (!s.item) return { refusal: s.refusal ? s.refusal.kind : 'REFUSED' };
    return { level: String(s.item.priceLevel || ''), total: money(s.grandTotal * s.qty), picks: Object.keys(s.item.engineConfig.picks || {}).length,
        rows: s.item.pricingBreakdown.map(l => [String(l.legacyErpId || ''), Number(l.qty) || 0, Number(l.price) || 0, Number(l.total) || 0]) };
}

/** HQ's answers against the server's, one for one. */
export function compareCheck(mine = [], theirs = []) {
    const differ = [];
    mine.forEach((m, i) => {
        const t = theirs[i];
        if (!t) { differ.push({ index: i, why: 'the server gave no answer' }); return; }
        if (t.error) { differ.push({ index: i, why: `the server stopped: ${t.error}` }); return; }
        if (m.refusal || t.refusal) { if (m.refusal !== t.refusal) differ.push({ index: i, why: `HQ ${m.refusal ? `refuses (${m.refusal})` : 'builds a line'}, the server ${t.refusal ? `refuses (${t.refusal})` : 'builds a line'}` }); return; }
        if (m.level !== t.level) { differ.push({ index: i, why: `price level: HQ ${m.level || '—'}, the server ${t.level || '—'}` }); return; }
        const a = JSON.stringify(m.rows), b = JSON.stringify(t.rows);
        if (a !== b) {
            const k = m.rows.findIndex((r, j) => JSON.stringify(r) !== JSON.stringify((t.rows || [])[j]));
            const say = (r) => (r ? `${r[0]} ×${r[1]} at $${r[2]}` : 'no row');
            differ.push({ index: i, why: `${m.rows.length} rows / ${(t.rows || []).length} rows — first difference: HQ ${say(m.rows[k < 0 ? m.rows.length : k])}, the server ${say((t.rows || [])[k < 0 ? m.rows.length : k])}` });
            return;
        }
        if (money(m.total) !== money(t.total)) differ.push({ index: i, why: `the total: HQ $${money(m.total)}, the server $${money(t.total)}` });
    });
    return { asked: mine.length, same: mine.length - differ.length, lines: mine.filter(m => !m.refusal).length, differ };
}

/** What the operator is told. `mineWorld` / `world` say what each side read: { assembly, pins, parts, finishes, chart }. */
export function checkSummary({ flowName = '', customerName = '', report, world = null, mineWorld = null, server = null, engineVersion = '' }) {
    const worldSame = !!world && !!mineWorld && ['assembly', 'pins', 'parts', 'finishes', 'chart'].every(k => String(world[k]) === String(mineWorld[k]));
    const read = (w) => (w ? `${w.pins} pins · ${w.parts} library records · ${w.finishes} finishes · traverse chart ${w.chart ? 'yes' : 'no'}` : '—');
    const head = `Portal server check — ${flowName || 'this flow'}${customerName ? `, as ${customerName}` : ', with no customer'}`;
    const engines = server ? (server.engineVersion === engineVersion ? `Same engine on both sides (${engineVersion}).` : `⚠ DIFFERENT ENGINES: HQ runs ${engineVersion}, the portal's server runs ${server.engineVersion || '—'} — deploy the portal functions from Cloud Shell.`) : '';
    const verdict = report.differ.length === 0
        ? `✓ The server builds what HQ builds: ${report.asked} configurations asked, ${report.lines} cart lines identical row for row, ${report.asked - report.lines} refused for the same reason.`
        : `✗ ${report.differ.length} of ${report.asked} configurations DIFFER (${report.same} agree):\n${report.differ.slice(0, 6).map(d => `   #${d.index + 1}: ${d.why}`).join('\n')}${report.differ.length > 6 ? `\n   … and ${report.differ.length - 6} more` : ''}`;
    const worlds = worldSame ? `Both read the same: ${read(world)}.` : `What each side read —\n   HQ:      ${read(mineWorld)}\n   server:  ${read(world)}${world && world.customer ? ` (customer: ${world.customer})` : ''}`;
    return [head, '', verdict, '', worlds, engines].filter(x => x !== '').join('\n');
}
