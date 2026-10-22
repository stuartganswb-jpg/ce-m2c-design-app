// ── WHO SEES WHICH QUOTES AND ORDERS ON THE PORTAL (Stuart 2026-10-22) ──────────────────────────────────────────────────────────
// "orders and quotes tab we are going to want to limit that for now to only orders and quotes that the user configured via the
// portal (team member). then team lead can see all their team members quotes and orders grouped by the member. Leave regional
// member access alone now till i get further clarity" · "go with recommendations" (a login with no team entry keeps the whole
// account — what 10. CRM's Departments & Team Access has always promised).
//
// The team is the CRM record's portalTeam ({ email, name, role: LEAD | MEMBER | REGIONAL, department, departments }), kept on
// 10. CRM → the account → Departments & Team Access. The login is the email on its sign-in token — never anything the browser sends.
//   MEMBER     what they sent from the portal (Configure or Quick Ship)
//   LEAD       what they sent and what everyone in their department sent — grouped by person, theirs first
//   REGIONAL   the whole account, as before (left alone until Stuart says)
//   no entry   the whole account, as before
// WHO SENT A QUOTE: its portal creation stamp — createdBy via PORTAL (both portal requests write it; CPQ prices the request in its
// own record and keeps it; Order Entry carries it onto the quote it prices the request as, Shared/quoteChain.portalSenderStampOf) —
// else portalRequest.byEmail (requests from before createdBy), else its chain's root (a revision Order Entry saves of such a quote
// names the request as its rootQuote). WHO SENT AN ORDER: whoever sent the quote it came from — the CPQ door names its job
// (hqJobId), Order Entry the quote it came from and the chain before it (fromQuote, quoteChain). A quote or order nobody sent from
// the portal (the team built it in CPQ or tab 7) shows only to the logins that see the whole account.
// Pure — scripts/portalVisibility.test.mjs.

const str = (v) => String(v == null ? '' : v).trim();
const emailOf = (v) => str(v).toLowerCase();

/** Finds a job by its doc id or jobId. */
const jobIndexOf = (jobs) => {
    const m = new Map();
    (Array.isArray(jobs) ? jobs : []).forEach((j) => { if (j) [j.id, j.jobId].filter(Boolean).forEach((k) => m.set(str(k), j)); });
    return (key) => m.get(str(key)) || null;
};

/** A job's own portal sender (a lower-case email); '' when it was not sent from the portal. */
const ownSenderOf = (job) => {
    if (!job) return '';
    const cb = job.createdBy;
    if (cb && typeof cb === 'object' && cb.via === 'PORTAL' && emailOf(cb.email)) return emailOf(cb.email);
    return emailOf(job.portalRequest && job.portalRequest.byEmail);
};

/** A quote's sender: its own, else its chain root's. `jobOf` finds a job by key (jobIndexOf). */
const senderOfJob = (job, jobOf = () => null) => {
    const own = ownSenderOf(job);
    if (own || !job) return own;
    const root = str(job.rootQuote);
    return root && root !== str(job.jobId || job.id) ? ownSenderOf(jobOf(root)) : '';
};

/** An order's sender: the sender of the quote it came from. */
const senderOfOrder = (so, jobOf = () => null) => {
    if (!so) return '';
    for (const key of [so.hqJobId, so.fromQuote, ...(Array.isArray(so.quoteChain) ? so.quoteChain : [])]) {
        if (!str(key)) continue;
        const sender = senderOfJob(jobOf(key), jobOf);
        if (sender) return sender;
    }
    return '';
};

/**
 * What a login sees. { role: 'MEMBER' | 'LEAD' | 'ALL', email, circle: Set of sender emails it sees (null = everything),
 * people: a lead's group order — themselves first, then their department by name }.
 */
const viewOf = ({ email, team } = {}) => {
    const me = emailOf(email);
    const list = (Array.isArray(team) ? team : []).filter((t) => t && emailOf(t.email));
    const entry = me ? list.find((t) => emailOf(t.email) === me) : null;
    const role = entry ? str(entry.role).toUpperCase() : '';
    const nameOf = (t) => str(t.name) || emailOf(t.email);
    if (role === 'MEMBER') return { role: 'MEMBER', email: me, circle: new Set([me]), people: [] };
    if (role === 'LEAD') {
        const dept = str(entry.department);
        const mates = dept ? list.filter((t) => emailOf(t.email) !== me && str(t.department) === dept && ['MEMBER', 'LEAD'].includes(str(t.role).toUpperCase())) : [];
        const people = [{ email: me, name: nameOf(entry), you: true },
            ...mates.map((t) => ({ email: emailOf(t.email), name: nameOf(t), you: false })).sort((a, b) => a.name.localeCompare(b.name))]
            .filter((p, i, all) => all.findIndex((q) => q.email === p.email) === i);
        return { role: 'LEAD', email: me, department: dept, circle: new Set(people.map((p) => p.email)), people };
    }
    // REGIONAL (left alone until Stuart says) and a login with no team entry: the whole account, as before
    return { role: 'ALL', email: me, circle: null, people: [] };
};

/** Whether the login sees something sent by `sender` ('' = not sent from the portal). */
const sees = (view, sender) => !view || view.role === 'ALL' || (!!sender && view.circle.has(emailOf(sender)));

/** The group a lead files it under ('p0' = the lead); null outside a lead's view. */
const personKeyOf = (view, sender) => {
    if (!view || view.role !== 'LEAD') return null;
    const i = view.people.findIndex((p) => p.email === emailOf(sender));
    return i < 0 ? null : `p${i}`;
};

/** What the portal is told about the view — no emails: the role and, for a lead, the people in order. */
const publicViewOf = (view) => ({
    role: (view && view.role) || 'ALL',
    ...(view && view.role === 'LEAD' ? { people: view.people.map((p, i) => ({ key: `p${i}`, name: p.name, you: p.you })) } : {}),
});

module.exports = { jobIndexOf, ownSenderOf, senderOfJob, senderOfOrder, viewOf, sees, personKeyOf, publicViewOf };
