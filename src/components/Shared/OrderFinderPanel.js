// FIND A SALES ORDER BY ITS NUMBER.
//
// Stuart 2026-09-26: "the only way to see an open order is to go back to the CRM and find its
// card" — so this is the shortcut, not a new home for orders. Type the number, pick the order,
// land on its real card with every rule the card has always had.
//
// It renders no order and offers no action. The card owns Modify, Reopen, Close and Payment, and
// owns the locks on them; duplicating any of that here would be a second copy of the truth.
import React, { useMemo, useState } from 'react';
import { findOrders } from './orderFinder';

const theme = { ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', paper: '#faf8f5', mono: "'IBM Plex Mono', monospace", sans: "'Inter', -apple-system, sans-serif" };
const label = { fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.12em', color: theme.inkSoft };
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—');

export default function OrderFinderPanel({ jobs = [], oeOrders = [], onOpen }) {
    const [term, setTerm] = useState('');
    const [showClosed, setShowClosed] = useState(false);

    // Both lists are already live in memory, so results appear as the number is typed — no button,
    // no wait, no read.
    const { matches, closedCount } = useMemo(
        () => findOrders({ jobs, oeOrders, term, openOnly: !showClosed }),
        [jobs, oeOrders, term, showClosed],
    );
    const typed = term.trim().length >= 2;

    return (
        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ ...label, color: theme.brass }}>Find an order</span>
                <input
                    autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
                    placeholder="Sales order number…"
                    style={{ flex: '1 1 260px', padding: '12px', fontFamily: theme.mono, fontSize: '0.95rem', border: `1px solid ${theme.line}`, outline: 'none' }}
                />
                {!!term && (
                    <button onClick={() => { setTerm(''); setShowClosed(false); }} style={{ padding: '10px 16px', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, cursor: 'pointer', ...label }}>Clear</button>
                )}
            </div>

            {!typed && (
                <p style={{ margin: '14px 0 0', fontSize: '0.85rem', color: theme.inkSoft, fontFamily: theme.sans }}>
                    Type a sales order number — the NetSuite number, the app's own, or just the digits.
                    Open orders from both doors are searched: CPQ quotes that became orders, and Order Entry.
                </p>
            )}

            {typed && !matches.length && (
                <div style={{ marginTop: '14px', fontSize: '0.88rem', color: theme.inkSoft, fontFamily: theme.sans }}>
                    {/* Never a bare "no results" for an order that plainly exists — that sends someone
                        hunting in NetSuite for a record that was here all along. */}
                    {closedCount > 0 ? (
                        <>
                            Nothing <strong>open</strong> matches “{term.trim()}” — but {closedCount} closed or completed
                            order{closedCount === 1 ? '' : 's'} do.{' '}
                            <button onClick={() => setShowClosed(true)} style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${theme.brass}`, color: theme.brass, cursor: 'pointer', font: 'inherit', padding: 0 }}>Show {closedCount === 1 ? 'it' : 'them'}</button>
                        </>
                    ) : `No order matches “${term.trim()}”.`}
                </div>
            )}

            {!!matches.length && (
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {showClosed && <div style={label}>Including closed and completed</div>}
                    {matches.map((m) => (
                        <button
                            key={`${m.kind}-${m.id}`} onClick={() => onOpen && onOpen(m)}
                            title={`Open ${m.customerName || 'this customer'}'s card at this order`}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', width: '100%', padding: '12px 14px', background: m.open ? theme.paper : '#fff', border: `1px solid ${theme.line}`, borderLeft: `3px solid ${m.open ? theme.brass : theme.line}`, cursor: 'pointer', fontFamily: theme.sans }}
                        >
                            <span style={{ flex: '0 0 auto', fontFamily: theme.mono, fontSize: '0.9rem', fontWeight: 600, color: theme.ink }}>
                                {m.soNumber || m.number}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.ink, fontSize: '0.88rem' }}>
                                {m.customerName || '—'}
                                {m.jobName ? <span style={{ color: theme.inkSoft }}> · {m.jobName}</span> : null}
                                {m.poNumber ? <span style={{ color: theme.inkSoft }}> · PO {m.poNumber}</span> : null}
                            </span>
                            <span style={{ ...label, flex: '0 0 auto' }}>{m.kind === 'OE' ? 'Order Entry' : 'CPQ'}</span>
                            <span style={{ ...label, flex: '0 0 auto', color: theme.ink, border: `1px solid ${theme.line}`, padding: '3px 8px' }}>{(m.status || '—').replace(/_/g, ' ')}</span>
                            <span style={{ ...label, flex: '0 0 auto' }}>{day(m.createdAtMs)}</span>
                        </button>
                    ))}
                    {matches.length >= 25 && (
                        <div style={{ ...label, paddingTop: '4px' }}>First 25 shown — type more of the number to narrow it.</div>
                    )}
                </div>
            )}
        </div>
    );
}
