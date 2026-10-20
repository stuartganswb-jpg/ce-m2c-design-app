// 🧾 NETSUITE TO FIX TODAY — the list, its chip, and the one read behind both (Stuart 2026-10-20: "detail these so they can
// be fixed before days end but keep the floor moving" · "eric will own list"). What is on it and why: Shared/nsFixList.
//   · NsFixPanel — 11.1 shows it at the top; the chip opens it anywhere else.
//   · NsFixChip  — RTG and the WMS header: "NetSuite: 3 to fix", red, one tap opens the list.
// The read is three small listeners (the queue's last fortnight, every refused entry, every failed direct call), shared by
// the chip and the list it opens — never one per row.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc } from 'firebase/firestore';
import { nsProxyFetch } from './nsProxy';
import {
    fixRowsOf, resendPatchOf, resendWriteBackOf, waitingBehindOf, rewaitPatchOf, fixMarkOf, tranLookupSql, fixChipTextOf,
    FIX_HOW, FIX_WINDOW_DAYS, NS_FIX_OWNER, DIRECT_NO_RESEND,
} from './nsFixList';

const DAY = 86400000;
const mono = { fontFamily: 'var(--mono)', fontSize: '10px' };
const RED = '#c0392b', ORANGE = '#c77d1a', GREEN = '#3a7d44';
const whenOf = (ms, withDay) => (ms ? new Date(ms).toLocaleString(undefined, withDay ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' }) : '—');

/** The one read: { rows, earlier, counts, outbox, err }. */
export function useNsFixes({ enabled = true } = {}) {
    const [recent, setRecent] = useState([]);
    const [failed, setFailed] = useState([]);
    const [logs, setLogs] = useState([]);
    const [err, setErr] = useState('');
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!enabled) return undefined;
        const since = Date.now() - (FIX_WINDOW_DAYS + 1) * DAY;
        const fail = (what) => (e) => setErr(`${what}: ${e.message || e}`);
        const u1 = onSnapshot(query(collection(db, 'ns_outbox'), where('createdAt', '>=', since)), s => setRecent(s.docs.map(d => ({ id: d.id, ...d.data() }))), fail('queue'));
        const u2 = onSnapshot(query(collection(db, 'ns_outbox'), where('status', '==', 'FAILED')), s => setFailed(s.docs.map(d => ({ id: d.id, ...d.data() }))), fail('refusals'));
        const u3 = onSnapshot(query(collection(db, 'hq_logs'), where('audit.ok', '==', false)), s => setLogs(s.docs.map(d => ({ id: d.id, ...d.data() }))), fail('direct calls'));
        const tick = setInterval(() => setNow(Date.now()), 60000);
        return () => { u1(); u2(); u3(); clearInterval(tick); };
    }, [enabled]);
    const outbox = useMemo(() => { const m = new Map(); [...failed, ...recent].forEach(e => m.set(e.id, e)); return [...m.values()]; }, [recent, failed]);
    const result = useMemo(() => fixRowsOf({ outbox, directLogs: logs, now }), [outbox, logs, now]);
    return { ...result, outbox, err };
}

const btn = (color) => ({ padding: '6px 11px', background: 'transparent', border: `1px solid ${color}`, color, cursor: 'pointer', ...mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' });

/** One row and its three ways off the list. */
function FixRow({ r, outbox, currentUser, canAct, onNote }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const by = currentUser || '';
    const tone = r.state === 'STUCK' ? ORANGE : RED;
    const markDoc = () => (r.source === 'QUEUE' ? doc(db, 'ns_outbox', r.id) : doc(db, 'hq_logs', r.id));
    const markField = r.source === 'QUEUE' ? 'fix' : 'nsFix';
    const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { alert(e.message || String(e)); } finally { setBusy(false); } };

    const resend = () => run(async () => {
        if (!window.confirm(`↻ Re-send "${r.label}" to NetSuite?\n\nFix it in NetSuite FIRST (${r.fix})\n\nIt goes back into the queue now and posts within about a minute. It is checked for an already-posted copy first, so it can never post twice.`)) return;
        // A re-sent write never rolls its record back: a status it would set is dropped once the record has moved on.
        const wbs = Array.isArray(r.raw.writeBack) ? r.raw.writeBack : (r.raw.writeBack ? [r.raw.writeBack] : []);
        const now = {};
        for (const wb of wbs.filter(w => w && w.collection && w.docId && w.patch && 'status' in w.patch)) {
            try { const sn = await getDoc(doc(db, wb.collection, String(wb.docId))); now[`${wb.collection}/${wb.docId}`] = sn.exists() ? sn.data() : null; } catch (e) { /* unread — sent as it was */ }
        }
        await updateDoc(doc(db, 'ns_outbox', r.id), resendPatchOf(r.raw, { by, writeBack: resendWriteBackOf(r.raw, (c, id) => now[`${c}/${id}`]) }));
        const behind = waitingBehindOf(r.raw, outbox);
        for (const c of behind) await updateDoc(doc(db, 'ns_outbox', c.id), rewaitPatchOf({ by }));
        onNote(`↻ ${r.label} — back in the queue${behind.length ? ` (with ${behind.length} that wait on it)` : ''}.`);
    });
    const doneInNs = () => run(async () => {
        const ref = window.prompt(`✓ Done in NetSuite — "${r.label}"\n\nType the NetSuite transaction number that did it (IA27606, ASSYB10633, IR5021 …):`, '');
        if (ref === null) return;
        const sql = tranLookupSql(ref);
        if (!sql) return alert('Type the transaction number — nothing was marked.');
        const resp = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: sql } });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(`NetSuite could not be asked (${JSON.stringify(data).slice(0, 200)}) — nothing was marked.`);
        const hit = (data.items || [])[0];
        if (!hit) return alert(`NetSuite has no transaction "${String(ref).trim()}" — nothing was marked. Check the number.`);
        await updateDoc(markDoc(), { [markField]: fixMarkOf({ how: FIX_HOW.DONE_IN_NS, by, nsRef: { id: String(hit.id), tranid: hit.tranid || '', type: hit.type || '' } }) });
        onNote(`✓ ${r.label} — done in NetSuite as ${hit.tranid || hit.id}.`);
    });
    const notNeeded = () => run(async () => {
        const why = window.prompt(`✕ Not needed — "${r.label}"\n\nWhy? (kept on the record)`, r.laterHint ? 'went through on a later try' : '');
        if (why === null) return;
        if (!String(why).trim()) return alert('A reason is needed — nothing was marked.');
        await updateDoc(markDoc(), { [markField]: fixMarkOf({ how: FIX_HOW.NOT_NEEDED, by, why }) });
        onNote(`✕ ${r.label} — marked not needed.`);
    });

    return (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--paper-2)', borderLeft: `3px solid ${tone}`, background: r.carried ? '#fdf6f5' : '#fff' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', ...mono, color: 'var(--ink-soft)' }}>
                <span style={{ color: r.carried ? RED : 'var(--ink-soft)' }}>{r.carried ? `⚠ ${whenOf(r.at, true)} — from before today` : whenOf(r.at)}</span>
                {r.who && <b style={{ color: 'var(--ink)' }}>{r.who}</b>}
                {r.page && <span>{r.page}</span>}
                <span>{r.type}{r.source === 'DIRECT' ? ' · sent straight to NetSuite' : ''}</span>
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', margin: '4px 0 2px' }}>{r.label}</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.88rem', color: tone, fontWeight: 600 }}>{r.state === 'STUCK' ? '⏳' : '⛔'} {r.words}</div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.84rem', color: 'var(--ink-soft)', marginTop: '2px' }}>→ {r.fix}</div>
            {r.laterHint && <div style={{ ...mono, color: GREEN, marginTop: '4px' }}>✓ The same thing went through later{r.laterHint.ref ? ` as ${r.laterHint.ref}` : ''}{r.laterHint.who ? ` (${r.laterHint.who})` : ''} · {whenOf(r.laterHint.at, true)} — if that covers it, mark it Not needed.</div>}
            {r.source === 'DIRECT' && <div style={{ ...mono, color: 'var(--ink-soft)', marginTop: '4px' }}>{DIRECT_NO_RESEND}</div>}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
                {canAct && r.canResend && <button disabled={busy} onClick={resend} style={btn('var(--ink)')}>↻ Re-send</button>}
                {canAct && r.state === 'REFUSED' && <button disabled={busy} onClick={doneInNs} style={btn(GREEN)}>✓ Done in NetSuite</button>}
                {canAct && r.state === 'REFUSED' && <button disabled={busy} onClick={notNeeded} style={btn('var(--ink-soft)')}>✕ Not needed</button>}
                {r.detail && <button onClick={() => setOpen(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...mono, fontSize: '9px', color: 'var(--ink-soft)', textDecoration: 'underline' }}>{open ? 'hide' : 'NetSuite\'s words'}</button>}
            </div>
            {open && <div style={{ ...mono, color: 'var(--ink-soft)', marginTop: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.detail}</div>}
        </div>
    );
}

/** The list. `data` = a useNsFixes() result the host already holds (the chip passes its own); else it reads for itself. */
export function NsFixPanel({ currentUser = '', canAct = true, data = null, onClose = null }) {
    const own = useNsFixes({ enabled: !data });
    const d = data || own;
    const [note, setNote] = useState('');
    const [showEarlier, setShowEarlier] = useState(false);
    const { rows = [], earlier = [], counts = { open: 0, carried: 0, today: 0, earlier: 0 }, outbox = [], err = '' } = d;
    return (
        <div style={{ background: '#fff', border: `1px solid ${counts.open ? RED : 'var(--line)'}`, borderRadius: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', padding: '14px 18px', background: counts.open ? '#fdf3f3' : 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>🧾 NetSuite to fix today</span>
                <span style={{ ...mono, color: counts.open ? RED : GREEN }}>{counts.open ? `${counts.open} open${counts.carried ? ` · ${counts.carried} from before today` : ''}` : 'nothing owed ✓'}</span>
                <span style={{ ...mono, color: 'var(--ink-soft)' }}>owner {NS_FIX_OWNER} · the floor keeps moving — put these right in NetSuite before the day ends · 3 pm note on OS Comms</span>
                {onClose && <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', ...mono, color: 'var(--ink-soft)' }}>✕ close</button>}
            </div>
            {err && <div style={{ padding: '8px 18px', ...mono, color: RED }}>Could not read — {err}. What is shown is what could be read.</div>}
            {note && <div style={{ padding: '8px 18px', ...mono, color: GREEN, borderBottom: '1px solid var(--paper-2)' }}>{note}</div>}
            {!rows.length && <div style={{ padding: '14px 18px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>Nothing is owed to NetSuite — every write of the last {FIX_WINDOW_DAYS} days went through or was dealt with.</div>}
            <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {rows.map(r => <FixRow key={r.key} r={r} outbox={outbox} currentUser={currentUser} canAct={canAct} onNote={setNote} />)}
                {earlier.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--line)' }}>
                        <button onClick={() => setShowEarlier(v => !v)} style={{ width: '100%', textAlign: 'left', padding: '10px 18px', background: 'var(--paper)', border: 'none', cursor: 'pointer', ...mono, color: 'var(--ink-soft)' }}>
                            {showEarlier ? '▾' : '▸'} {earlier.length} older than {FIX_WINDOW_DAYS} days, never dealt with — not counted above
                        </button>
                        {showEarlier && earlier.map(r => <FixRow key={r.key} r={r} outbox={outbox} currentUser={currentUser} canAct={canAct} onNote={setNote} />)}
                    </div>
                )}
            </div>
        </div>
    );
}

/** The chip: the count, and the list one tap away. */
export function NsFixChip({ currentUser = '', canAct = true, style = {} }) {
    const data = useNsFixes();
    const [open, setOpen] = useState(false);
    const n = data.counts.open;
    return (
        <>
            <button onClick={() => setOpen(true)} title={n ? 'NetSuite refused these — the floor kept moving; open the list to put them right' : 'Nothing is owed to NetSuite'}
                style={{ padding: '7px 11px', background: n ? RED : 'transparent', color: n ? '#fff' : GREEN, border: `1px solid ${n ? RED : 'var(--line)'}`, cursor: 'pointer', ...mono, letterSpacing: '.04em', whiteSpace: 'nowrap', ...style }}>
                🧾 {fixChipTextOf(data.counts)}
            </button>
            {open && (
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(20,18,15,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto' }}>
                    <div onClick={e => e.stopPropagation()} style={{ width: 'min(860px, 100%)' }}>
                        <NsFixPanel currentUser={currentUser} canAct={canAct} data={data} onClose={() => setOpen(false)} />
                    </div>
                </div>
            )}
        </>
    );
}

export default NsFixPanel;
