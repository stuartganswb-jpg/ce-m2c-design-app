import React from 'react';
import { reviewWaitingOf, waitedText } from './reviewWaiting';

// ORDERS WAITING FOR A PERSON'S REVIEW — on RTG, under the red "stopped" banner (Stuart 2026-10-12: "RTG is master of
// order details, state it there"). Nothing has started on the lines listed; the reason is the one the automatic start
// recorded. The button is the card's own "Review & start" — one door into the review, never a second one.
const ReviewWaitingBanner = ({ orders = [], onReview, style }) => {
    const rows = reviewWaitingOf(orders);
    if (!rows.length) return null;
    return (
        <div style={{ background: '#fdf8ee', border: '2px solid var(--brass)', padding: '16px 20px', marginBottom: '24px', ...style }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', color: '#8a6d1f', fontWeight: 700, marginBottom: '12px' }}>
                ⏳ {rows.length} order{rows.length === 1 ? '' : 's'} WAITING FOR REVIEW — nothing has started on these lines
            </div>
            {rows.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid rgba(138,109,31,.25)' }}>
                    <div style={{ minWidth: '170px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 700, color: '#8a6d1f' }}>{/^SO/i.test(r.ref) ? r.ref : `SO ${r.ref}`}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginTop: '3px' }}>
                            {r.customer}{r.customer ? ' · ' : ''}<span style={{ color: r.days >= 3 ? '#d9534f' : 'var(--ink-soft)', fontWeight: r.days >= 3 ? 700 : 400 }}>waiting {waitedText(r.days)}</span>
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: '260px' }}>
                        {r.state === 'FAILED' && <div style={{ fontSize: '0.9rem', color: '#d9534f', fontWeight: 500 }}>The automatic start failed{r.error ? ` — ${r.error}` : ''}. It retries; or start it from the review.</div>}
                        {r.lines.map(l => (
                            <div key={l.lineIdx} style={{ fontSize: '0.9rem', color: 'var(--ink)', marginTop: '2px' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', fontWeight: 700 }}>Line {l.lineIdx + 1} · {l.erp}{l.finish ? ` · ${l.finish}` : ''}</span>
                                {l.reason ? <span style={{ color: 'var(--ink-soft)' }}> — {l.reason}</span> : null}
                            </div>
                        ))}
                    </div>
                    {onReview && (
                        <button onClick={() => onReview(r)}
                            title="Opens this order's review on Order Entry Needs — the same review the card's button opens."
                            style={{ background: 'transparent', border: '1px solid var(--brass)', color: '#8a6d1f', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
                            Review &amp; start →
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};

export default ReviewWaitingBanner;
