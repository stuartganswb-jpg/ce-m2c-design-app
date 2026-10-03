// ── 🧾 AUDIT LOG — the bottom of RTG (Stuart 2026-10-03) ────────────────────────────────────────────────────────
// "what page, item/qty affect, whom did it, what it states on page, what it states in Netsuite (WO, SO, IA, etc) add
//  a orange text on any netsuite transaction that may be questionable that it went thru."
// One row per event from what the app already keeps — the NetSuite queue (history from 7/17), the direct NetSuite
// calls (logged from 10/3), the apps' activity logs, the finishing floor's punches, the deletion ledger — plus the
// NetSuite transactions the app should have made and did not. "What the app says" is the linked record read now;
// "What NetSuite says" is read back from NetSuite on request (SuiteQL, read-only). Red = did not go through;
// orange = may not have; ✓ green = read back and it matches. The rules live in Shared/auditLog (tested). This
// panel WRITES NOTHING. Retrying a failed write stays where it is: the Transmit Log above / 11.1 Sync Queue.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc } from 'firebase/firestore';
import { nsProxyFetch } from '../Shared/nsProxy';
import {
    rowFromOutbox, rowFromHqLog, rowFromFinLog, rowFromDeletion, expectedBuildRowOf, expectedReceiptRowOf, appSaysOf,
    verifyTargetsOf, txQueryOf, linesQueryOf, buildLinksQueryOf, indexReadBack, verifyVerdictOf, flagsOf, filterRows,
    pageGroupsOf, isNsRow, QTY_CHECKED,
} from '../Shared/auditLog';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
const CAP = 1500;           // per source, per load
const PAGE = 200;           // rows drawn at a time
const COLOR = { red: '#d9534f', orange: '#e07b00', ok: '#3a7d44', posted: 'var(--ink)', info: 'var(--ink-soft)', cancelled: 'var(--ink-soft)' };
const SOURCE_LABEL = { NS_QUEUE: 'NetSuite queue', NS_DIRECT: 'NetSuite direct', EXPECTED: 'Expected', APP: 'App', FLOOR: 'Floor', DELETION: 'Deleted' };
const OPEN_KEY = 'rtgAuditLogOpen';

const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const startOf = (s) => new Date(`${s}T00:00:00`).getTime();
const endOf = (s) => new Date(`${s}T23:59:59.999`).getTime();
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const when = (ms) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

const suiteql = async (q) => {
    if (!q) return { items: [], hasMore: false };
    const r = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((b && (b['o:errorDetails'] && b['o:errorDetails'][0] && b['o:errorDetails'][0].detail)) || (b && (b.title || b.error)) || `HTTP ${r.status}`);
    return { items: (b.items || []).map(({ links, ...x }) => x), hasMore: !!b.hasMore };
};

const th = { padding: '9px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', fontWeight: 500, position: 'sticky', top: 0, background: 'var(--paper)', whiteSpace: 'nowrap' };
const td = { padding: '8px 12px', verticalAlign: 'top', fontSize: '0.8rem', color: 'var(--ink)' };
const btn = { padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', whiteSpace: 'nowrap' };

export default function AuditLogPanel() {
    const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (e) { return false; } });
    const [fromDay, setFromDay] = useState(() => dayOf(Date.now() - 6 * 86400000));
    const [toDay, setToDay] = useState(() => dayOf(Date.now()));
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [notes, setNotes] = useState([]);           // load warnings (a source capped / unreadable)
    const [appDocs, setAppDocs] = useState({});       // 'coll/id' → doc | null
    const [verify, setVerify] = useState({});         // row key → verdict
    const [verifying, setVerifying] = useState(false);
    const [verifiedAt, setVerifiedAt] = useState(null);
    const [err, setErr] = useState('');
    const [f, setF] = useState({ page: '', who: '', q: '', nsOnly: false, questionableOnly: false });
    const [shown, setShown] = useState(PAGE);
    const [openKey, setOpenKey] = useState(null);
    const triedRef = useRef(new Set());               // app records already asked for (a failed read is not retried in a loop)

    const toggle = () => setOpen(v => { const n = !v; try { localStorage.setItem(OPEN_KEY, n ? '1' : '0'); } catch (e) { /* convenience only */ } return n; });

    const load = useCallback(async () => {
        setLoading(true); setErr(''); setNotes([]);
        const from = startOf(fromDay), to = endOf(toDay);
        const safe = (label, p, cap) => p.then(s => {
            const docs = s.docs.map(d => ({ id: d.id, ...d.data() }));
            return { docs, note: cap && docs.length >= cap ? `${label}: showing the newest ${cap} — narrow the dates to see the rest` : '' };
        }).catch(e => ({ docs: [], note: `${label} could not be read (${e.message || e})` }));
        const [ob, hl, fl, dl, packed, plat] = await Promise.all([
            safe('NetSuite queue', getDocs(query(collection(db, 'ns_outbox'), where('createdAt', '>=', from), where('createdAt', '<=', to), orderBy('createdAt', 'desc'), limit(CAP))), CAP),
            safe('Activity log', getDocs(query(collection(db, 'hq_logs'), where('t', '>=', new Date(from)), where('t', '<=', new Date(to)), orderBy('t', 'desc'), limit(CAP))), CAP),
            safe('Finishing floor log', getDocs(query(collection(db, 'fin_logs'), where('t', '>=', new Date(from)), where('t', '<=', new Date(to)), orderBy('t', 'desc'), limit(CAP))), CAP),
            safe('Deletion ledger', getDocs(query(collection(db, 'hq_deletion_log'), where('at', '>=', from), where('at', '<=', to), orderBy('at', 'desc'), limit(500))), 500),
            safe('Packed jobs', getDocs(query(collection(db, 'fin_workorders'), where('packedAt', '>=', from), where('packedAt', '<=', to)))),
            safe('Plating returns', getDocs(query(collection(db, 'plating_shipments'), where('status', '==', 'received')))),
        ]);
        // A packed job the server builds, with no build posted — and none in the queue (the server's own entry
        // `wocmpl-<id>`, or RTG's repair, dedupeKey `wocmpl:<id>`). A queued one is its own queue row.
        const expected = [];
        for (const fin of packed.docs) {
            const r = expectedBuildRowOf(fin);
            if (!r) continue;
            try {
                const [s1, s2] = await Promise.all([
                    getDoc(doc(db, 'ns_outbox', `wocmpl-${String(fin.id).replace(/[^A-Za-z0-9_-]/g, '_')}`)),
                    getDocs(query(collection(db, 'ns_outbox'), where('dedupeKey', '==', `wocmpl:${fin.id}`))),
                ]);
                if (s1.exists() || s2.docs.some(d => d.data().status !== 'CANCELLED')) continue;
            } catch (e) { /* unreadable: show it — the read-back settles it */ }
            expected.push(r);
        }
        const receipts = plat.docs.map(l => expectedReceiptRowOf(l)).filter(r => r && (!r.at || (r.at >= from && r.at <= to)));
        const all = [
            ...ob.docs.map(rowFromOutbox), ...hl.docs.map(rowFromHqLog), ...fl.docs.map(rowFromFinLog), ...dl.docs.map(rowFromDeletion),
            ...expected, ...receipts,
        ].sort((a, b) => (b.at || 0) - (a.at || 0));
        // The expected rows carry their own record.
        const pre = {};
        [...expected, ...receipts].forEach(r => { pre[`${r.appRef.coll}/${r.appRef.id}`] = r.raw; });
        triedRef.current = new Set(Object.keys(pre));
        setRows(all); setAppDocs(pre); setVerify({}); setVerifiedAt(null); setShown(PAGE);
        setNotes([ob, hl, fl, dl, packed, plat].map(x => x.note).filter(Boolean));
        setLoading(false);
    }, [fromDay, toDay]);

    useEffect(() => { if (open) load(); }, [open, load]);

    const levelOf = useCallback((r) => flagsOf(r, { appDoc: r.appRef ? appDocs[`${r.appRef.coll}/${r.appRef.id}`] : undefined, verify: verify[r.key] }).level, [appDocs, verify]);
    const filtered = useMemo(() => filterRows(rows, f, levelOf), [rows, f, levelOf]);
    const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
    const pages = useMemo(() => pageGroupsOf(rows), [rows]);
    const whos = useMemo(() => [...new Set(rows.map(r => r.who).filter(Boolean))].sort(), [rows]);
    const counts = useMemo(() => {
        const c = { ns: 0, red: 0, orange: 0, ok: 0 };
        rows.forEach(r => { if (isNsRow(r)) c.ns++; const l = levelOf(r); if (c[l] != null) c[l]++; });
        return c;
    }, [rows, levelOf]);

    // "What the app says" — the linked record, read now, for the NetSuite rows on screen.
    useEffect(() => {
        if (!open) return;
        const want = [...new Set(visible.filter(r => r.appRef && isNsRow(r)).map(r => `${r.appRef.coll}/${r.appRef.id}`))].filter(k => !triedRef.current.has(k)).slice(0, 120);
        if (!want.length) return;
        want.forEach(k => triedRef.current.add(k));
        // No cancel-on-change: the rows on screen change as these land, and a key once asked for is never asked again.
        (async () => {
            const got = {};
            for (const part of chunks(want, 20)) {
                await Promise.all(part.map(async (k) => {
                    const i = k.indexOf('/');
                    try { const s = await getDoc(doc(db, k.slice(0, i), k.slice(i + 1))); got[k] = s.exists() ? { id: s.id, ...s.data() } : null; }
                    catch (e) { got[k] = undefined; }
                }));
            }
            setAppDocs(prev => ({ ...prev, ...Object.fromEntries(Object.entries(got).filter(([, v]) => v !== undefined)) }));
        })();
    }, [open, visible]);

    // "What NetSuite says" — read back, for the NetSuite rows in view.
    const runVerify = async () => {
        const nsRows = filtered.filter(isNsRow).slice(0, 400);
        const { txIds, woIds } = verifyTargetsOf(nsRows);
        if (!txIds.length && !woIds.length) { setErr('Nothing in view has a NetSuite number to read back.'); return; }
        setVerifying(true); setErr('');
        try {
            const links = [], tx = [], lines = [];
            let linesComplete = true;
            for (const part of chunks(woIds, 100)) links.push(...(await suiteql(buildLinksQueryOf(part))).items);
            const buildIds = [...new Set(links.map(l => String(l.id)))];
            for (const part of chunks(txIds, 100)) tx.push(...(await suiteql(txQueryOf(part))).items);
            const qtyIds = [...new Set([...tx.filter(t => QTY_CHECKED.includes(t.type)).map(t => String(t.id)), ...buildIds])];
            for (const part of chunks(qtyIds, 50)) { const res = await suiteql(linesQueryOf(part)); lines.push(...res.items); if (res.hasMore) linesComplete = false; }
            const idx = indexReadBack({ tx, lines, links, linesComplete });
            const v = {};
            nsRows.forEach(r => { const x = verifyVerdictOf(r, idx); if (x) v[r.key] = x; });
            setVerify(prev => ({ ...prev, ...v })); setVerifiedAt(Date.now());
            if (!linesComplete) setErr('NetSuite cut a line read short — quantities were not compared on those rows (nothing was called different).');
        } catch (e) { setErr(`NetSuite read-back failed: ${e.message || e}`); }
        setVerifying(false);
    };

    const nsCell = (r, flags) => {
        if (!r.ns) return <span style={{ color: 'var(--line)' }}>—</span>;
        const v = verify[r.key];
        const c = COLOR[flags.level] || 'var(--ink)';
        const base = v && v.text ? v.text : (r.source === 'EXPECTED'
            ? `${r.ns.type} — none in the app`
            : `${r.ns.type}${r.ns.tran ? ` ${r.ns.tran}` : ''} · ${r.ns.status || '—'}`);
        return (
            <div>
                <span style={{ color: flags.level === 'ok' ? COLOR.ok : (['red', 'orange'].includes(flags.level) ? c : 'var(--ink)'), fontWeight: ['red', 'orange'].includes(flags.level) ? 600 : 400 }}>
                    {flags.level === 'ok' ? '✓ ' : ''}{base}
                </span>
                {['red', 'orange'].includes(flags.level) && flags.reasons.map((x, i) => (
                    <div key={i} style={{ color: c, fontSize: '0.75rem', marginTop: '2px' }}>{flags.level === 'red' ? '✕' : '⚠'} {x}</div>
                ))}
            </div>
        );
    };

    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', marginTop: '24px', marginBottom: '24px' }}>
            <div onClick={toggle} style={{ padding: '16px 24px', background: 'var(--paper-2)', borderBottom: open ? '1px solid var(--line)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Every page · who · item × qty · what the app says · what NetSuite says</span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>🧾 Audit Log</span>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                    {open && rows.length ? <>{rows.length} events · {counts.ns} NetSuite{counts.red ? <b style={{ color: COLOR.red }}> · {counts.red} failed</b> : null}{counts.orange ? <b style={{ color: COLOR.orange }}> · {counts.orange} questionable</b> : null}{counts.ok ? <span style={{ color: COLOR.ok }}> · {counts.ok} ✓</span> : null} · </> : null}
                    {open ? '▼ HIDE' : '▶ SHOW'}
                </span>
            </div>
            {open && (
                <div>
                    <div style={{ padding: '12px 24px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--paper-2)', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                        <label>From <input type="date" value={fromDay} max={toDay} onChange={e => e.target.value && setFromDay(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: '11px' }} /></label>
                        <label>To <input type="date" value={toDay} min={fromDay} onChange={e => e.target.value && setToDay(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: '11px' }} /></label>
                        <select value={f.page} onChange={e => { setF(x => ({ ...x, page: e.target.value })); setShown(PAGE); }} style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>
                            <option value="">Every page</option>
                            {pages.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <select value={f.who} onChange={e => { setF(x => ({ ...x, who: e.target.value })); setShown(PAGE); }} style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>
                            <option value="">Everyone</option>
                            {whos.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                        <input value={f.q} onChange={e => { setF(x => ({ ...x, q: e.target.value })); setShown(PAGE); }} placeholder="WO / SO / item / IA #…" style={{ fontFamily: 'var(--mono)', fontSize: '11px', padding: '5px 8px', border: '1px solid var(--line)', minWidth: '180px' }} />
                        <label style={{ cursor: 'pointer' }}><input type="checkbox" checked={f.nsOnly} onChange={e => setF(x => ({ ...x, nsOnly: e.target.checked }))} /> NetSuite only</label>
                        <label style={{ cursor: 'pointer', color: COLOR.orange }}><input type="checkbox" checked={f.questionableOnly} onChange={e => setF(x => ({ ...x, questionableOnly: e.target.checked }))} /> Failed / questionable only</label>
                        <span style={{ flex: 1 }} />
                        <button onClick={load} disabled={loading} style={btn}>{loading ? 'Loading…' : '↻ Reload'}</button>
                        <button onClick={runVerify} disabled={verifying || loading} title="Reads NetSuite (read-only) for the NetSuite rows in view: is each transaction there, its number, status and quantity — and was an expected build made outside the app?"
                            style={{ ...btn, background: 'var(--ink)', color: '#fff', border: 'none' }}>{verifying ? 'Reading NetSuite…' : '✓ Verify with NetSuite'}</button>
                    </div>
                    <div style={{ padding: '8px 24px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', display: 'flex', gap: '14px', flexWrap: 'wrap', borderBottom: '1px solid var(--paper-2)' }}>
                        <span><b style={{ color: COLOR.red }}>✕ red</b> did not go through</span>
                        <span><b style={{ color: COLOR.orange }}>⚠ orange</b> may not have — check NetSuite</span>
                        <span><b style={{ color: COLOR.ok }}>✓ green</b> read back from NetSuite and it matches</span>
                        <span>{verifiedAt ? `read back ${when(verifiedAt)}` : 'not read back yet — press Verify'}</span>
                    </div>
                    {(notes.length > 0 || err) && (
                        <div style={{ padding: '8px 24px', fontFamily: 'var(--mono)', fontSize: '10px', color: COLOR.orange, borderBottom: '1px solid var(--paper-2)' }}>
                            {[...notes, err].filter(Boolean).map((n, i) => <div key={i}>⚠ {n}</div>)}
                        </div>
                    )}
                    <div style={{ maxHeight: '620px', overflow: 'auto' }}>
                        {!loading && filtered.length === 0 && <div style={{ padding: '20px 24px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Nothing in these dates{f.q || f.page || f.who || f.nsOnly || f.questionableOnly ? ' for this filter' : ''}.</div>}
                        {filtered.length > 0 && (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', minWidth: '1100px' }}>
                                <thead>
                                    <tr>{['When', 'Page', 'Who', 'Item × Qty', 'What happened', 'What the app says', 'What NetSuite says'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {visible.map(r => {
                                        const appDoc = r.appRef ? appDocs[`${r.appRef.coll}/${r.appRef.id}`] : undefined;
                                        const flags = flagsOf(r, { appDoc, verify: verify[r.key] });
                                        const edge = ['red', 'orange'].includes(flags.level) ? COLOR[flags.level] : (flags.level === 'ok' ? COLOR.ok : 'transparent');
                                        const isOpen = openKey === r.key;
                                        return (
                                            <React.Fragment key={r.key}>
                                                <tr onClick={() => setOpenKey(isOpen ? null : r.key)} style={{ borderTop: '1px solid var(--paper-2)', cursor: 'pointer', boxShadow: `inset 3px 0 0 ${edge}`, background: isOpen ? 'var(--paper)' : '#fff' }}>
                                                    <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                                                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.page}<div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{SOURCE_LABEL[r.source] || r.source}</div></td>
                                                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.who || '—'}</td>
                                                    <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px', whiteSpace: 'nowrap' }}>{r.item ? `${r.item}${r.qty != null ? ` × ${r.qty}` : ''}` : (r.qty != null ? `× ${r.qty}` : '—')}</td>
                                                    <td style={{ ...td, maxWidth: '340px' }}>{r.action || '—'}</td>
                                                    <td style={{ ...td, maxWidth: '280px', color: 'var(--ink-soft)' }}>{r.appRef ? (appSaysOf(r.appRef.coll, appDoc) || (isNsRow(r) ? '…' : r.appRef.id)) : '—'}</td>
                                                    <td style={{ ...td, maxWidth: '340px' }}>{nsCell(r, flags)}</td>
                                                </tr>
                                                {isOpen && (
                                                    <tr style={{ background: 'var(--paper)' }}>
                                                        <td colSpan={7} style={{ padding: '10px 24px 14px', fontFamily: 'var(--mono)', fontSize: '11px', lineHeight: 1.7, color: 'var(--ink)', userSelect: 'text' }}>
                                                            {r.ns && <div>NETSUITE: {r.ns.type}{r.ns.kind ? ` (${r.ns.kind})` : ''} · {r.ns.status || '—'}{r.ns.id ? ` · internal id ${r.ns.id}` : ''}{r.ns.tran ? ` · ${r.ns.tran}` : ''}{r.ns.woTran ? ` · against ${r.ns.woTran} (id ${r.ns.woId})` : ''}{r.ns.attempts ? ` · try ${r.ns.attempts}` : ''}{r.ns.postedAt ? ` · posted ${when(r.ns.postedAt)}` : ''}</div>}
                                                            {flags.reasons.length > 0 && <div style={{ color: COLOR[flags.level] || 'var(--ink-soft)' }}>{flags.reasons.join(' · ')}</div>}
                                                            {r.raw && r.raw.targetUrl && <div style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>CALLED: {String(r.raw.method || '')} {String(r.raw.targetUrl).split('/services/rest/')[1] || r.raw.targetUrl}</div>}
                                                            {r.raw && r.raw.payload && <div style={{ color: 'var(--ink-soft)', overflowWrap: 'anywhere' }}>SENT: {JSON.stringify(r.raw.payload).slice(0, 600)}</div>}
                                                            {r.ns && r.ns.error && <div style={{ color: COLOR.red, overflowWrap: 'anywhere' }}>NETSUITE SAID: {String(r.ns.error).slice(0, 800)}</div>}
                                                            {r.appRef && <div style={{ color: 'var(--ink-soft)' }}>APP RECORD: {r.appRef.coll}/{r.appRef.id}</div>}
                                                            {r.ns && r.ns.status === 'FAILED' && r.source === 'NS_QUEUE' && <div style={{ color: 'var(--ink-soft)' }}>Retry it from the NetSuite Transmit Log above or HQ 11.1 → NetSuite Sync Queue.</div>}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                        {filtered.length > shown && (
                            <div style={{ padding: '12px 24px' }}>
                                <button onClick={() => setShown(s => s + PAGE)} style={btn}>Show {Math.min(PAGE, filtered.length - shown)} more ({filtered.length - shown} left)</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
