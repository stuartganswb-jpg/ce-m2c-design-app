// READING WHAT THE CONVERT RESTLET SOURCED (Stuart 2026-08-06: the floor hit "You still need to
// reconfigure the inventory detail record after changing the quantity. (at step: save)" converting
// off the phosphate cart, on an assembly whose sibling lines in the SAME cart converted fine).
//
// WHY A MODULE AND NOT A FEW LINES OF JSX: the RESTlet's `diag:true` mode returns the component
// structure WITHOUT saving, which is the only way to see a production BOM from here — App Check
// means no script can read this account. That reply is the evidence, so the reading of it has to be
// testable rather than eyeballed once on a tablet at the packing bench.
//
// THE DISTINCTION THAT MATTERS. A diag reply that looks "all green" can still fail at save, so a
// verdict of "everything resolved" is not the same as "this will build". The reply is a snapshot
// taken at step 'built-detail', BEFORE `b.save()` — the save is where NetSuite re-validates every
// inventory detail against its line. So this module reports two different things and never conflates
// them:
//   what the RESTlet MANAGED to configure   (per-line: bin, status, assigned total)
//   what is still LEFT DANGLING at save     (a component line the loop selected and never committed)
//
// THE TAIL RULE. ce_convert_build_restlet.js walks the component sublist with selectLine(i), and only
// calls commitLine when it successfully writes inventory detail on that line. A line that cannot take
// detail — a Phosphating charge, a non-inventory component — throws, is caught, and is left SELECTED
// AND UNCOMMITTED. If another line follows, the next selectLine discards it harmlessly. If it is the
// LAST line, it is still open when save() runs, and NetSuite resolves it during the save — a line
// change after the details were written, which is precisely the sentence the floor saw. So the
// position of a skipped line is not cosmetic: same BOM contents, different order, different outcome.
// That is why `tailUncommitted` is computed from the LAST line rather than from any line.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isNum = (v) => v !== undefined && v !== null && Number.isFinite(Number(v));

// Per-line state. Ordered by how much it tells you: a line that BLOCKED names itself, a line that was
// SKIPPED is the one to look at next, and NO_STOCK is a data answer rather than a script one.
export const LINE_STATES = {
    OK: 'OK',                 // detail written, into a bin that holds stock, totalling the line qty
    NOT_TRACKED: 'NOT_TRACKED', // takes no detail (a Phosphating charge) AND was closed — the healthy path
    MISMATCH: 'MISMATCH',     // detail written but the assigned total != the line quantity
    NO_STOCK: 'NO_STOCK',     // nothing on hand to consume — NetSuite cannot assign a bin at all
    SKIPPED: 'SKIPPED',       // NetSuite refused the detail subrecord and the line was left OPEN
    BLOCKED: 'BLOCKED',       // the line REQUIRED detail and threw — the RESTlet aborts on these
};
// A state that is not a problem. Kept as one list so the summary, the verdict and the row icon
// cannot disagree about whether a line is fine.
export const isHealthyState = (s) => s === LINE_STATES.OK || s === LINE_STATES.NOT_TRACKED;

// One component line of the RESTlet's `diag` array, read into something with a name.
export function readLine(d) {
    const requiresDetail = d.reqd === true || d.reqd === 'T' || d.reqd === 1 || d.reqd === '1';
    const assigned = isNum(d.detailTotal) ? num(d.detailTotal) : null;
    const needed = num(d.qtyUsed);
    // `cancelled` is stamped by the FIXED RESTlet when it explicitly closes a line it could not
    // detail. Its presence is how this readout tells the two scripts apart: without it a skipped
    // line is left open (and the tail rule applies), with it the line is closed and harmless. That
    // matters because the same reply must stop accusing the RESTlet once the fix is uploaded.
    const cancelled = d.cancelled === true;
    let state;
    if (d.error && requiresDetail) state = LINE_STATES.BLOCKED;
    else if ((d.error || !d.detailed) && cancelled) state = LINE_STATES.NOT_TRACKED;
    else if (d.error || !d.detailed) state = LINE_STATES.SKIPPED;
    else if (!d.srcOnhand && !d.useBinId) state = LINE_STATES.NO_STOCK;
    else if (assigned !== null && needed > 0 && Math.abs(assigned - needed) > 1e-9) state = LINE_STATES.MISMATCH;
    else state = LINE_STATES.OK;

    return {
        line: num(d.line),
        item: d.item,
        needed,
        qLine: num(d.qLine),
        qBom: num(d.qBom),
        // A quantity the RESTlet GUESSED rather than read: the line quantity came back 0, so it fell
        // back to bomquantity x build qty. The guess is what the inventory detail is written against,
        // and save() re-sources the real one — if they differ, the detail is stale on arrival.
        guessedQty: num(d.qLine) === 0 && needed > 0,
        fractional: !Number.isInteger(num(d.qBom)) && num(d.qBom) > 0,
        onHand: isNum(d.srcOnhand) ? num(d.srcOnhand) : null,
        binId: d.useBinId || null,
        statusId: d.useStatus || null,
        preExisting: isNum(d.preExistingAssignments) ? num(d.preExistingAssignments) : null,
        assigned,
        assignedLines: isNum(d.detailLines) ? num(d.detailLines) : null,
        detailed: !!d.detailed,
        requiresDetail,
        cancelled,
        error: d.error || null,
        state,
    };
}

export const VERDICTS = {
    READY: 'READY',
    TAIL_UNCOMMITTED: 'TAIL_UNCOMMITTED',
    BLOCKED: 'BLOCKED',
    NO_STOCK: 'NO_STOCK',
    MISMATCH: 'MISMATCH',
    GUESSED_QTY: 'GUESSED_QTY',
    NO_RECEIVE_BIN: 'NO_RECEIVE_BIN',
    ERROR: 'ERROR',
};

// THE ONE CALL. Takes the RESTlet's diag reply verbatim and says what it means.
export function readConvertDiag(res) {
    if (!res || res.error || res.success === false) {
        return {
            ok: false, verdict: VERDICTS.ERROR, lines: [], built: null,
            error: (res && (res.error || res.message)) || 'No reply from the RESTlet.',
            advice: 'The BOM check itself failed, so nothing was read. The message above is NetSuite\'s.',
        };
    }

    const raw = Array.isArray(res.diag) ? res.diag : [];
    const lines = raw.filter(d => d && d.item !== undefined).map(readLine);
    const built = res.builtDetail || (raw.find(d => d && d.builtDetail) || {}).builtDetail || null;

    // The tail rule (see the header): only a SKIPPED/BLOCKED line in LAST position is still open when
    // save() runs. Anywhere else the next selectLine discards it.
    const last = lines.length ? lines[lines.length - 1] : null;
    const tailUncommitted = !!last && !last.cancelled && (last.state === LINE_STATES.SKIPPED || last.state === LINE_STATES.BLOCKED);

    const blocked = lines.filter(l => l.state === LINE_STATES.BLOCKED);
    const noStock = lines.filter(l => l.state === LINE_STATES.NO_STOCK);
    const mismatch = lines.filter(l => l.state === LINE_STATES.MISMATCH);
    const guessed = lines.filter(l => l.guessedQty);
    const receiveMissing = !!built && built.attempted && !built.detailed;

    let verdict, advice;
    if (blocked.length) {
        verdict = VERDICTS.BLOCKED;
        advice = `Line ${blocked[0].line + 1} REQUIRES inventory detail and NetSuite refused it — the RESTlet aborts on these, so no build can post until that line resolves. NetSuite said: ${blocked[0].error}`;
    } else if (tailUncommitted) {
        verdict = VERDICTS.TAIL_UNCOMMITTED;
        advice = `The LAST component line (line ${last.line + 1}) could not take inventory detail, so the RESTlet left it selected and never committed it. It is still open when the build saves, and NetSuite resolves it there — that is what "reconfigure the inventory detail record after changing the quantity" is reporting. The same line sitting anywhere but last would be harmless. Fix is in ce_convert_build_restlet.js (commit or discard the line before moving on), which must be re-uploaded in NetSuite by hand.`;
    } else if (noStock.length) {
        verdict = VERDICTS.NO_STOCK;
        advice = `Line ${noStock[0].line + 1} has nothing on hand, so NetSuite cannot assign a consume bin for it. This is a stock answer, not a script one — finish a batch of that component first.`;
    } else if (mismatch.length) {
        const m = mismatch[0];
        verdict = VERDICTS.MISMATCH;
        advice = `Line ${m.line + 1} assigned ${m.assigned} against a line needing ${m.needed}. The detail total has to equal the line quantity exactly.`;
    } else if (guessed.length) {
        const g = guessed[0];
        verdict = VERDICTS.GUESSED_QTY;
        advice = `Line ${g.line + 1} reported quantity 0 when the loop read it, so the RESTlet wrote its detail against a GUESS of ${g.needed} (bomquantity ${g.qBom} x build qty). If the save re-sources a different number the detail is stale and the build is rejected.`;
    } else if (receiveMissing) {
        verdict = VERDICTS.NO_RECEIVE_BIN;
        advice = `Every component resolved, but the finished assembly's receive detail did not: ${built.error || 'the put-away bin could not be resolved at this location'}. Check the put-away bin exists at this location.`;
    } else {
        const closed = lines.filter(l => l.state === LINE_STATES.NOT_TRACKED);
        verdict = VERDICTS.READY;
        advice = closed.length
            ? `Every stock component resolved to a bin, and line ${closed[0].line + 1} takes no inventory detail at all (NetSuite: "${closed[0].error || 'not detail-tracked'}") — the script closed that line explicitly, so it is not left open at save. This line should build.`
            : 'Every component resolved to a bin with stock and the receive bin took its detail. Nothing here explains a save-time rejection — if this line still fails, the reply above is what to send on.';
    }

    return {
        ok: verdict === VERDICTS.READY,
        verdict, lines, built,
        error: null,
        tailUncommitted,
        advice,
    };
}

// A one-line summary for a dense row, so the cart can say what happened without expanding.
export const diagSummary = (r) => {
    if (!r) return '';
    if (r.verdict === VERDICTS.ERROR) return 'check failed';
    const bad = r.lines.filter(l => !isHealthyState(l.state)).length;
    return bad ? `${bad} of ${r.lines.length} component line${r.lines.length === 1 ? '' : 's'} unresolved` : `${r.lines.length} component line${r.lines.length === 1 ? '' : 's'} all resolved`;
};
