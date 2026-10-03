// ── WHERE AM I, AND WHO? — the page every audit record names (Stuart 2026-10-03, RTG's Audit Log) ──────────────
// "what page, item/qty affect, whom did it". Each app (HQ, WMS, Shop, Finishing) says which tab is open and who
// is signed in; the NetSuite queue stamps it on every new entry (Shared/nsOutbox), the direct NetSuite calls log
// it (Shared/nsProxy), and the apps' activity logs carry it. One module-level record per browser tab — each app
// is its own route, so only one app ever sets it at a time.

let ctx = { app: '', tab: '', user: '' };

/** An app tells the audit trail which tab is open and who is signed in. */
export const setAuditPage = ({ app, tab, user } = {}) => {
    ctx = {
        app: app != null ? String(app) : ctx.app,
        tab: tab != null ? String(tab) : ctx.tab,
        user: user != null ? String(user) : ctx.user,
    };
};

/** "HQ · 11. RTG Dispatch" — or '' before any app said. */
export const auditPageOf = () => [ctx.app, ctx.tab].filter(Boolean).join(' · ');

/** The signed-in name the app last gave. */
export const auditUserOf = () => ctx.user || '';
