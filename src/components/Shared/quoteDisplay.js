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
