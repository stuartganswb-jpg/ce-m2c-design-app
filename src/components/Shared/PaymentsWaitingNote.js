// ⏳ "MONEY TAKEN, NETSUITE NOT TOLD" — the note that keeps appearing until someone deals with it.
//
// Stuart 2026-10-17, on where it should show: "have it keep popping up on end of day summary and
// sales dashboard", at 24 hours — "the money will post the next day and need to be addressed".
//
// One component, mounted on both screens, so the two cannot come to say different things. It reads
// only, writes nothing, and when there is nothing overdue it renders NOTHING — a banner that is
// always there is a banner nobody reads.
import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { waitingRowsOf, overdueOf, waitingSummary, waitingLine } from './paymentsWaiting';

export default function PaymentsWaitingNote({ compact = false }) {
    const [rows, setRows] = useState(null);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await httpsCallable(functions, 'paymentsWaiting')({});
                if (!alive) return;
                setRows(waitingRowsOf(res.data.payments || [], Date.now()));
                setTruncated(res.data.truncated === true);
            } catch (e) {
                if (alive) setRows([]);     // a dashboard still draws when payments are unreachable
            }
        })();
        return () => { alive = false; };
    }, []);

    const over = overdueOf(rows || []);
    if (!over.length) return null;          // nothing wrong, nothing said

    return (
        <div style={{
            border: '1px solid #b3362f', borderLeft: '4px solid #b3362f', background: '#fdf4f3',
            padding: compact ? '10px 14px' : '14px 18px', marginBottom: '16px',
        }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#b3362f', marginBottom: '6px' }}>
                ⏳ Money taken · NetSuite not told
            </div>
            <div style={{ fontSize: compact ? '0.86rem' : '0.95rem', color: 'var(--ink)', marginBottom: over.length ? '8px' : 0 }}>
                {waitingSummary(rows || [])}
            </div>
            {!compact && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {over.slice(0, 6).map((r) => (
                        <div key={r.id} style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{waitingLine(r)}</div>
                    ))}
                    {over.length > 6 && (
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>…and {over.length - 6} more.</div>
                    )}
                </div>
            )}
            <div style={{ fontSize: '11.5px', color: 'var(--ink-soft)', marginTop: '8px' }}>
                They retry by themselves. One that will not clear is usually a customer or a sales order NetSuite has
                never seen — HQ 11.1 names the reason for each, and Post now forces a retry.
                {truncated ? ' More than a hundred are unposted, so this is only the newest.' : ''}
            </div>
        </div>
    );
}
