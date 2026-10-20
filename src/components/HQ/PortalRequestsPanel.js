// PORTAL REQUESTS, RIGHT ON THE CRM'S MAIN SCREEN (Stuart 2026-10-20: "Portal Requests right on CRM main screen add * everytime a new
// that has never been opened arrives"). Every request a customer sent from the portal that is still waiting for us, newest first — this
// brand's and any whose customer carries no brand, so none is invisible — with a red * on each one nobody has opened yet (the same reading
// as HQ's * on the CRM tab: Shared/portalRequests). Open = the customer's card at it: a configured request is priced from the card's
// Reopen CPQ, a Quick Ship request is loaded from 7. Quick Ship's own card. Nothing shows when nothing is waiting.
import React from 'react';
import { quoteDisplayNo } from '../Shared/quoteDisplay';
import { isUnopened, requestKindOf, requestSummaryOf, requestTotalOf } from '../Shared/portalRequests';

const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PortalRequestsPanel({ requests = [], onOpen }) {
    if (!requests.length) return null;
    const fresh = requests.filter(isUnopened).length;
    return (
        <div data-portal-requests style={{ background: '#fff', border: '1px solid var(--brass)', padding: '16px 24px', borderRadius: '2px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', marginBottom: '10px' }}>
                Portal Requests · {requests.length} waiting{fresh ? <span style={{ color: '#d9534f' }}> · {fresh} new *</span> : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
                {requests.map(job => {
                    const isNew = isUnopened(job);
                    const total = requestTotalOf(job);
                    const opened = job.portalRequest?.openedAt;
                    const quickShip = requestKindOf(job) === 'Quick Ship';
                    return (
                        <div key={job.id} data-portal-request={job.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 12px', background: isNew ? 'var(--paper-2)' : '#fff', border: '1px solid var(--line)' }}>
                            <span title={isNew ? 'New — nobody has opened it yet' : `Opened by ${job.portalRequest?.openedBy || 'staff'}${opened ? ` · ${new Date(opened).toLocaleString()}` : ''}`}
                                style={{ width: '12px', color: '#d9534f', fontSize: '17px', fontWeight: 700, lineHeight: 1 }}>{isNew ? '*' : ''}</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', minWidth: '110px' }}>{quoteDisplayNo(job)}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.9rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {job.customer?.name || '?'}{job.jobName ? ` · ${job.jobName}` : ''}
                                {!job.brandId && <span style={{ color: '#d9534f', fontSize: '0.8rem' }}> · no brand on this customer's CRM record — set it there so the request shows on their card</span>}
                            </span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                                {requestKindOf(job)} · {requestSummaryOf(job)}{total ? ` · ${money(total)}` : ''}{job.dateSaved ? ` · ${new Date(job.dateSaved).toLocaleDateString()}` : ''}
                            </span>
                            <button onClick={() => onOpen(job)}
                                title={quickShip ? "Open the customer's card at this request — load it into the cart from 7. Quick Ship" : "Open the customer's card at this request — price it from Reopen CPQ"}
                                style={{ padding: '6px 14px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Open</button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
