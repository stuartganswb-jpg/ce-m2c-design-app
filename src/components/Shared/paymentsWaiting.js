// ⏳ MONEY TAKEN THAT NETSUITE HAS NOT HEARD ABOUT — Stuart 2026-10-17.
//
// A deposit that cannot post yet WAITS and retries, which is right: posting it against the wrong
// thing, or not at all, is worse. But a wait is only honest if somebody can see it. Until now HQ
// 11.1 said WHY a payment was waiting and never how LONG, so "waiting for the sales order, which
// lands in a minute" and "stuck since Tuesday because nothing will ever fix it by itself" looked
// exactly alike.
//
// That became urgent the day we learned an app-only customer is never re-stamped: such a deposit
// waits FOR EVER unless a person matches the customer to NetSuite (S7, 2026-10-17).
//
// Stuart's threshold: "24 hours is fine as the money will post the next day and need to be
// addressed". So anything still unposted a day later is wrong, and says so where he will see it —
// the end-of-day summary and the sales dashboard — rather than only on a queue nobody opens.

export const WAITING_HOURS = 24;
const HOUR = 3600000;

const ageHoursOf = (p, now) => Math.max(0, (Number(now) - Number((p && p.paidAt) || 0)) / HOUR);

// Money is "out" when it has been taken and NetSuite has neither accepted it nor been handed it.
export const isUnposted = (p) => !!p
    && Number(p.amount || 0) > 0
    && p.environment === 'PRODUCTION'          // a test payment was never going to post
    && p.netsuitePosted !== true
    && p.netsuiteQueued !== true;

// How it reads to a person: the age, and whether it has crossed the line.
export function waitingRowsOf(payments = [], now = Date.now(), hours = WAITING_HOURS) {
    return (Array.isArray(payments) ? payments : [])
        .filter(isUnposted)
        .map((p) => {
            const ageHours = ageHoursOf(p, now);
            return {
                id: p.id || '',
                reference: p.reference || '',
                amount: Number(p.amount || 0),
                reason: p.netsuiteWaiting || '',
                paidAt: Number(p.paidAt || 0),
                ageHours,
                ageDays: Math.floor(ageHours / 24),
                overdue: ageHours >= hours,
            };
        })
        .sort((a, b) => a.paidAt - b.paidAt);      // oldest first: the one to deal with is at the top
}

export const overdueOf = (rows = []) => (rows || []).filter((r) => r.overdue);

// One sentence, for a dashboard that has no room for a table. Says the money, because the money is
// the point — not the number of rows.
export function waitingSummary(rows = [], hours = WAITING_HOURS) {
    const over = overdueOf(rows);
    if (!over.length) return '';
    const total = over.reduce((s, r) => s + r.amount, 0);
    const oldest = over[0];
    const age = oldest.ageDays >= 1 ? `${oldest.ageDays} day${oldest.ageDays === 1 ? '' : 's'}` : `${Math.floor(oldest.ageHours)} hours`;
    return `${over.length} payment${over.length === 1 ? '' : 's'} totalling $${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `
        + `${over.length === 1 ? 'has' : 'have'} been taken but not posted to NetSuite — the oldest for ${age}.`;
}

// The words a person needs to act, per row.
export const waitingLine = (r) => {
    const age = r.ageDays >= 1 ? `${r.ageDays}d` : `${Math.floor(r.ageHours)}h`;
    return `${age} · $${Number(r.amount).toFixed(2)} · ${r.reference || '(no reference)'}${r.reason ? ` — ${r.reason}` : ''}`;
};
