// WHICH NUMBER A QUOTE SHOWS ON SCREEN — one rule, one place (Stuart 2026-08-03: "the
// sales/quotes are displaying with the app internal id rather than following the rule we put in to
// use either the Netsuite id when exists, if not the shortned version using the date").
//
// A job accumulates up to three identities over its life:
//   netsuiteEstimateId  the NetSuite record, once ERP Push/Pull has transmitted it — the number
//                       staff and the customer can both quote back at each other
//   quoteNo             the short date-stamped number minted at save (initials + MMDDYY + seq,
//                       e.g. SG080326-01) — readable, sortable, and ours
//   jobId / id          the internal doc id (QUOTE-1784673212204) — an epoch timestamp, meaningful
//                       to nobody, and the thing that was leaking onto the CRM cards
//
// Precedence follows what the OTHER party can act on: NetSuite's number beats ours, ours beats the
// raw doc id, and the doc id is the last resort so a screen is never blank.
export const quoteDisplayNo = (job) => {
    if (!job) return '';
    // The SALES ORDER number is the strongest identity of all — once it exists, that is the
    // transaction everyone means. Tran numbers (EST123 / SO456, stamped by the outbox writeBack
    // since 2026-08-25) beat raw internal ids.
    const soNo = String(job.netsuiteSalesOrderNo || '').trim();
    if (soNo) return soNo;
    const soId = String(job.netsuiteSalesOrderId || '').trim();
    if (soId && soId.toUpperCase() !== 'CREATED_CHECK_NETSUITE') return `NS SO ${soId}`;
    const estNo = String(job.netsuiteEstimateNo || '').trim();
    if (estNo) return estNo;
    const ns = String(job.netsuiteEstimateId || '').trim();
    // ERP Push/Pull stores this sentinel when NetSuite accepted the write but returned no id —
    // it is a status, not a number, so it must never be shown as one.
    if (ns && ns.toUpperCase() !== 'CREATED_CHECK_NETSUITE') return ns;
    const q = String(job.quoteNo || '').trim();
    if (q) return q;
    return String(job.jobId || job.id || '');
};

// WHO generated the quote — one rule, one place (Stuart 2026-08-09: "the user whom generates each
// quote should be attached to the document, so we can easily see it in both places").
//   createdBy   the immutable creation stamp: the portal submitter, or the staff member who first
//               finalized in CPQ. Written once, never overwritten.
//   author      re-stamped by every CPQ finalize — when it differs from the creator, it names who
//               last priced the quote, and the line says so.
// Older docs predate createdBy: fall back to portalRequest.byEmail, then author.
export const quoteAuthorLine = (job) => {
    if (!job) return '';
    const created = (job.createdBy && job.createdBy.name) || (job.portalRequest && job.portalRequest.byEmail) || job.author || '';
    if (!created) return '';
    const viaPortal = (job.createdBy && job.createdBy.via === 'PORTAL') || (!job.createdBy && !!job.portalRequest);
    const pricedBy = job.author && job.author !== created ? job.author : '';
    return `By ${created}${viaPortal ? ' (portal)' : ''}${pricedBy ? ` · priced by ${pricedBy}` : ''}`;
};

// True when what we're showing is the raw internal id — nothing better exists yet. Screens can use
// this to style it quietly rather than presenting an epoch stamp as if it were a quote number.
export const isInternalId = (job) => quoteDisplayNo(job) === String((job && (job.jobId || job.id)) || '')
    && !String((job && job.quoteNo) || '').trim();

// ── THE DATE ON THE PAPER (close-out item 6, S1 2026-09-12): `dateSaved` is 'YYYY-MM-DD' and
// `new Date('2026-09-10')` is UTC midnight — printed in Eastern that is the evening BEFORE, so
// every quotation carried a date one day early. A bare date is read as a LOCAL calendar day;
// anything else (an ISO stamp, a Firestore Timestamp, epoch ms) is a moment and prints as such.
export const docDateOf = (job, now = new Date()) => {
    const v = job && job.dateSaved;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
        const [y, m, d] = v.trim().split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString();
    }
    const c = job && job.createdAt;
    const ms = v ? Date.parse(v) : (c && typeof c.toMillis === 'function' ? c.toMillis() : (c && c.seconds ? c.seconds * 1000 : (typeof c === 'number' ? c : NaN)));
    if (Number.isFinite(ms)) return new Date(ms).toLocaleDateString();
    if (v) return String(v);
    return now.toLocaleDateString();
};

// ── "No Sidemark" IS NOT A SIDEMARK (close-out item 6): the cart's display placeholder was
// stamped on the line and reached NetSuite's line Tag (custcol3) as text. The placeholder reads
// as blank everywhere a value is used; the screens keep printing it as the empty-state word.
export const NO_SIDEMARK = 'No Sidemark';
export const cleanSidemark = (s) => { const t = String(s == null ? '' : s).trim(); return t.toLowerCase() === NO_SIDEMARK.toLowerCase() ? '' : t; };

// The typed order sidemark for a document: `orderSidemark` as typed, else the legacy `sidemark`
// unless it is just the job-name fallback (the CRM card's rule, one place).
export const orderSidemarkOf = (job) => {
    const jobName = String((job && job.jobName) || '').trim();
    const typed = String((job && job.orderSidemark) || '').trim();
    if (typed) return typed;
    const legacy = cleanSidemark(job && job.sidemark);
    return legacy && legacy !== jobName && legacy !== 'Multi-Room Project' ? legacy : '';
};
