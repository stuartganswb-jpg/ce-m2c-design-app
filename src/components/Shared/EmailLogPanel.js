// ✉️ WHAT THE APP HAS EMAILED — HQ 11 (Stuart 2026-10-16).
//
// An outbox nobody can see is only half an outbox. Every letter is here with where it went, what
// happened to it, and why if it failed — plus Resend, for the one that bounced and for the
// customer who says it never arrived.
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

const theme = { ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', mono: "'IBM Plex Mono', monospace" };
const label = { fontFamily: theme.mono, fontSize: '9.5px', letterSpacing: '.1em', textTransform: 'uppercase' };
const when = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const TONE = {
    SENT: { color: '#3a7d44', border: '#3a7d44' },
    PENDING: { color: '#9b6a2c', border: '#9b6a2c' },
    SENDING: { color: '#9b6a2c', border: '#9b6a2c' },
    FAILED: { color: '#9b2c2c', border: '#9b2c2c' },
    // Not a failure — a reason we chose not to write, said out loud rather than left to silence.
    SKIPPED: { color: '#524e46', border: 'rgba(28,26,22,.14)' },
};

export default function EmailLogPanel() {
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setErr('');
        try {
            const res = await httpsCallable(functions, 'emailLog')({});
            setRows(res.data.emails || []);
        } catch (e) { setErr(e.message || String(e)); setRows([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const resend = async (id) => {
        setBusy(id); setErr('');
        try {
            const res = await httpsCallable(functions, 'emailResend')({ id });
            if (res.data.status !== 'SENT') setErr(res.data.lastError || 'It did not send — the reason is on the row.');
            await load();
        } catch (e) { setErr(e.message || String(e)); }
        finally { setBusy(''); }
    };

    return (
        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '20px', marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ ...label, color: theme.brass }}>✉️ Email sent</span>
                <button onClick={load} style={{ ...label, padding: '6px 11px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', color: theme.ink }}>Refresh</button>
                <span style={{ fontSize: '12px', color: theme.inkSoft }}>
                    The last 30. A letter that failed says why and can be sent again.
                </span>
            </div>

            {err && <div style={{ fontSize: '12.5px', color: '#9b2c2c', marginBottom: '8px' }}>✗ {err}</div>}
            {rows === null && <div style={{ fontSize: '13px', color: theme.inkSoft }}>Reading…</div>}
            {rows && rows.length === 0 && (
                <div style={{ fontSize: '13px', color: theme.inkSoft }}>
                    Nothing sent yet. A brand sends only once it has its own Postmark server — Uniq'uity has one.
                </div>
            )}

            {rows && rows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {rows.map((r) => {
                        const tone = TONE[r.status] || { color: theme.inkSoft, border: theme.line };
                        return (
                            <div key={r.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: `1px dashed ${theme.line}`, paddingBottom: '6px' }}>
                                <span style={{ ...label, flex: '0 0 72px', padding: '3px 7px', border: `1px solid ${tone.border}`, color: tone.color, textAlign: 'center' }}>{r.status}</span>
                                <span style={{ flex: '1 1 240px', minWidth: 0, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.subject}>{r.subject || '(no subject)'}</span>
                                <span style={{ ...label, flex: '0 0 auto', color: theme.inkSoft }}>{r.brand.toUpperCase()}</span>
                                <span style={{ flex: '1 1 180px', minWidth: 0, fontSize: '12px', color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.to}>{r.to}</span>
                                <span style={{ ...label, flex: '0 0 auto', color: theme.inkSoft }}>{when(r.sentAt || r.createdAt)}</span>
                                {r.attempts > 1 && <span style={{ ...label, color: theme.inkSoft }}>{r.attempts} tries</span>}
                                <button onClick={() => resend(r.id)} disabled={busy === r.id} style={{ ...label, padding: '5px 10px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: busy === r.id ? 'wait' : 'pointer', color: theme.ink }}>
                                    {busy === r.id ? 'Sending…' : 'Resend'}
                                </button>
                                {/* The reason, in full — an outbox that hides why is no better than none. */}
                                {r.lastError && <div style={{ flex: '1 1 100%', fontSize: '11.5px', color: '#9b2c2c' }}>{r.lastError}</div>}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
