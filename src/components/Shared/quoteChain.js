// ── A QUOTE'S REVISIONS AND ITS CONVERSION, PURE (S7, 2026-10-16) ─────────────────────────────────
//
// Stuart: "when we reopen a quote and modify and save it is creating a new quote … we can continue to generate
// new, but then in the app we should add a marker that shows its relation so that when one becomes a sales order
// we can mark them as converted and closed". A reopened quote saved as a quote keeps making a NEW number (the
// paper history stays); the old one carries `supersededBy`, the new one `supersedes` (both since 2026-08-31) —
// this module reads that chain, names each revision, and closes the whole chain when any of it becomes an order.
//
//   chainOf(jobs, jobId)          every quote in the chain, root first
//   revisionStampOf(prev, jobs)   what a NEW quote superseding `prev` carries: rootQuote + revision
//   lineageWordsOf(job, jobs)     "Rev 2 · supersedes QSQUOTE-…" · "Superseded by …" · "Converted → …"
//   convertedPatchesOf(chain, so) the patch per quote when the chain becomes a sales order
//   isQuoteArchived(job)          superseded / converted / done — out of the active pipeline
//   portalSenderStampOf(job)      a portal request's sender, as the creation stamp of the quote Order Entry prices it as

const str = (v) => String(v == null ? '' : v).trim();

export const QUOTE_ARCHIVED_STATUSES = ['SUPERSEDED', 'CONVERTED', 'COMPLETED', 'SHIPPED', 'CANCELLED', 'TRANSMITTED_TO_ERP'];
export const isQuoteArchived = (job) => !!job && QUOTE_ARCHIVED_STATUSES.includes(str(job.status).toUpperCase());

const keyOf = (j) => str(j && (j.jobId || j.id));
const indexOf = (jobs = []) => { const m = new Map(); (jobs || []).forEach(j => { if (!j) return; [j.id, j.jobId].filter(Boolean).forEach(k => m.set(str(k), j)); }); return m; };

/** The chain a quote belongs to, root first, each quote once; the quote itself when nothing links to it. */
export function chainOf(jobs = [], jobId = '') {
    const idx = indexOf(jobs);
    const start = idx.get(str(jobId));
    if (!start) return [];
    const seen = new Set();
    // walk back to the root
    let root = start;
    for (let n = 0; n < 50; n += 1) {
        const prev = str(root.supersedes) ? idx.get(str(root.supersedes)) : null;
        if (!prev || seen.has(keyOf(prev))) break;
        seen.add(keyOf(prev));
        root = prev;
    }
    // walk forward from the root
    const out = [];
    const seen2 = new Set();
    let cur = root;
    for (let n = 0; n < 50 && cur && !seen2.has(keyOf(cur)); n += 1) {
        seen2.add(keyOf(cur));
        out.push(cur);
        cur = str(cur.supersededBy) ? idx.get(str(cur.supersededBy)) : null;
    }
    if (!out.some(j => keyOf(j) === keyOf(start))) out.push(start);
    return out;
}

/** What a NEW quote that supersedes `prev` carries. */
export const revisionStampOf = (prev, jobs = []) => {
    if (!prev) return { rootQuote: '', revision: 1 };
    const chain = chainOf(jobs.some(j => keyOf(j) === keyOf(prev)) ? jobs : [...jobs, prev], keyOf(prev));
    const root = chain[0] || prev;
    return { rootQuote: str(root.rootQuote) || keyOf(root), revision: Math.max(1, Number(prev.revision) || chain.length) + 1 };
};

/** The words beside a quote: its revision and what it supersedes, or what superseded / converted it. */
export function lineageWordsOf(job, jobs = []) {
    if (!job) return '';
    const parts = [];
    const st = str(job.status).toUpperCase();
    if (st === 'CONVERTED' || job.convertedTo) parts.push(`Converted → ${str(job.convertedToNo) || str(job.convertedTo) || 'sales order'}`);
    // (a portal request Order Entry priced never reached NetSuite — it has no estimate to close, 2026-10-22)
    else if (st === 'SUPERSEDED' || job.supersededBy) parts.push(str(job.source).toUpperCase() === 'PORTAL' && !str(job.netsuiteEstimateId) && !str(job.netsuiteEstimateNo)
        ? `Priced as ${str(job.supersededBy)}` : `Superseded by ${str(job.supersededBy)} — close its old NetSuite estimate by hand`);
    const rev = Number(job.revision) || (job.supersedes ? Math.max(2, chainOf(jobs, keyOf(job)).findIndex(j => keyOf(j) === keyOf(job)) + 1) : 0);
    if (rev > 1) parts.push(`Rev ${rev} · supersedes ${str(job.supersedes) || str(job.rootQuote)}`);
    return parts.join(' · ');
}

/** The patch for every quote in a chain when one of them becomes the sales order `so`. */
export const convertedPatchesOf = (chain = [], { soId = '', soNumber = '', by = '', at = 0 } = {}) => {
    const now = at || Date.now();
    return (chain || []).filter(j => j && str(j.status).toUpperCase() !== 'CONVERTED').map(j => ({
        id: j.id, patch: { status: 'CONVERTED', convertedTo: str(soId), convertedToNo: str(soNumber) || str(soId), convertedAt: now, convertedBy: str(by), ...(str(j.status).toUpperCase() !== 'CONVERTED' ? { statusBeforeConverted: str(j.status) } : {}) },
    }));
};

/** What the sales order records about the quotes it came from. */
export const fromQuoteStampOf = (chain = [], fromJobId = '') => ({ fromQuote: str(fromJobId), quoteChain: (chain || []).map(keyOf).filter(Boolean) });

// ── WHO SENT IT, CARRIED ONTO THE QUOTE THAT PRICES IT (Stuart 2026-10-22: the portal's Orders & Quotes shows each login what it
// sent). CPQ prices a portal request in the request's own record, which keeps its createdBy; Order Entry's Load builds a NEW quote,
// which takes this as its createdBy (`author` keeps the staff member) — so the CRM reads "By … (portal) · priced by …" from either
// door, and functions/portalVisibility finds the sender on the quote itself. Older requests carry only portalRequest.byEmail.
/** A portal request's sender as a creation stamp { name, email, via: 'PORTAL' }; null for anything not sent from the portal. */
export const portalSenderStampOf = (job) => {
    if (!job) return null;
    const cb = job.createdBy;
    if (cb && typeof cb === 'object' && cb.via === 'PORTAL' && (str(cb.email) || str(cb.name))) return { name: str(cb.name) || str(cb.email), email: str(cb.email).toLowerCase(), via: 'PORTAL' };
    const by = str(job.portalRequest && job.portalRequest.byEmail).toLowerCase();
    return by ? { name: by, email: by, via: 'PORTAL' } : null;
};
