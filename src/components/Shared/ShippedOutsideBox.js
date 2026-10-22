// ✓ SHIPPED OUTSIDE THE APP — the Fulfillment tab's NetSuite check and its one button (Stuart 2026-10-21, "go on the plan").
// The rules: Shared/shippedOutside. Mounted by Shared/fulfilmentPanel (the Payments session's file — it wires these in):
//   · useNsShipCheck — ONE read of NetSuite for every sales order on Ready to Ship (their status, the fulfilments made from
//     them), again only when the set of orders changes.
//   · NsShippedLine — the queue row's line: "✓ NetSuite shipped this — IF73569 · Sep 17 · Billed".
//   · ShippedOutsideBox — on the chosen order: what NetSuite says and, for a manager, "✓ Shipped outside the app", which
//     stamps every packed piece of that order shipped (the NetSuite fulfilment's date), tells the sales order and RTG the
//     way a UPS shipment does (propagateFloorState), and sends nothing to NetSuite.
import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, getDocs, updateDoc, query, collection, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { nsProxyFetch } from './nsProxy';
import { propagateFloorState } from './orderLifecycle';
import { isFloorSupervisor, normRole } from './finishingRoles';
import {
    soKeyOf, soStatusSqlOf, fulfilmentsSqlOf, indexShipChecks, checkFor, sameOrderDocsOf, outsideShipPatchOf, outsideShipConfirmOf,
} from './shippedOutside';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
const GREEN = '#3a7d44', AMBER = '#9b6a2c';
const suiteql = async (q) => {
    const resp = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(String((data && (data.title || data.error)) || `HTTP ${resp.status}`).slice(0, 160));
    return data.items || [];
};

/** { [docId]: check } for every document on the queue. `nsSoIdOf(d)` = the host's NetSuite sales-order id for a document. */
export function useNsShipCheck({ queue = [], nsSoIdOf = () => '' } = {}) {
    const keys = useMemo(() => (queue || []).map(d => ({ id: d.id, key: soKeyOf(d, nsSoIdOf(d)) })), [queue, nsSoIdOf]);
    const askKey = useMemo(() => JSON.stringify([...new Set(keys.map(k => `${k.key.nsId}|${k.key.tran}`))].sort()), [keys]);
    const [idx, setIdx] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let gone = false;
        const asked = JSON.parse(askKey).map(s => { const [nsId, tran] = s.split('|'); return { nsId, tran }; });
        const sql = soStatusSqlOf(asked);
        if (!sql) { setIdx({ byId: {}, byTran: {} }); return undefined; }
        (async () => {
            try {
                const so = await suiteql(sql);
                if (gone) return;
                const ifSql = fulfilmentsSqlOf(so.map(r => r.id));
                const ifs = ifSql ? await suiteql(ifSql) : [];
                if (!gone) { setIdx(indexShipChecks(so, ifs)); setErr(''); }
            } catch (e) { if (!gone) setErr(e.message || String(e)); }
        })();
        return () => { gone = true; };
    }, [askKey]);
    return useMemo(() => {
        const out = { _err: err, _ready: !!idx };
        keys.forEach(k => { out[k.id] = checkFor(k.key, idx); });
        return out;
    }, [keys, idx, err]);
}

/** The queue row's one line (nothing when NetSuite has not shipped or closed it). */
export function NsShippedLine({ check }) {
    if (!check || !check.line || check.state === 'OPEN') return null;
    const tone = check.state === 'SHIPPED' ? GREEN : AMBER;
    return <div style={{ fontSize: '11px', color: tone, marginTop: '2px' }}>{check.state === 'SHIPPED' ? '✓ ' : '⚠ '}{check.line}</div>;
}

/** On the chosen order: NetSuite's word, and the one button. */
export function ShippedOutsideBox({ doc: d, check, queue = [], operator, isQsOrder, packDocRef, soOf, packRefOf, nsSoIdOf = () => '', writeLog = () => {}, onDone = () => {} }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    if (!d || !check || check.state === 'OPEN' || check.state === 'UNKNOWN') return null;
    const canAct = isFloorSupervisor(operator) || normRole(operator && operator.role) === 'executive';
    const by = (operator && operator.name) || '';
    const docs = sameOrderDocsOf(d, queue, (x) => soKeyOf(x, nsSoIdOf(x)));

    const mark = async () => {
        if (!window.confirm(outsideShipConfirmOf({ check, docs, refOf: packRefOf }))) return;
        setBusy(true); setErr('');
        const patch = outsideShipPatchOf({ check, by });
        const done = [], failed = [];
        for (const x of docs) {
            try {
                await updateDoc(packDocRef(x), patch);
                done.push(packRefOf(x));
                try {
                    await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                        { finWo: x, by, extra: { shippedAt: patch.shippedAt, shipCarrier: patch.shipCarrier, shipService: patch.shipService } });
                } catch (e) { console.warn('RTG propagate failed (the mark stands):', e); }
            } catch (e) { failed.push(`${packRefOf(x)}: ${e.message || e}`); }
        }
        // The sales order is told once (a Quick Ship order IS the sales order — stamped above).
        const so = !isQsOrder(d) ? soOf(d) : null;
        if (so && so.id && done.length) await updateDoc(doc(db, 'hq_sales_orders', so.id), { shippedAt: patch.shippedAt, shipCarrier: patch.shipCarrier, shipService: patch.shipService }).catch(() => {});
        writeLog(`Marked ${check.tran} shipped outside the app (NetSuite ${check.status}${check.ifs.length ? ` · ${check.ifs.map(f => f.tranid).join(', ')}` : ''}) — ${done.join(', ')}`, 'fulfilment');
        setBusy(false);
        if (failed.length) setErr(`Not marked: ${failed.join(' · ')}`);
        else onDone(`✓ ${check.tran} marked shipped outside the app — ${done.length} piece${done.length === 1 ? '' : 's'} left Ready to Ship. Nothing was sent to NetSuite.`);
    };

    const shipped = check.state === 'SHIPPED';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '12px', border: `1px solid ${shipped ? GREEN : AMBER}`, background: '#fff' }}>
            <div style={{ flex: 1, minWidth: '240px', fontSize: '12px', color: shipped ? GREEN : AMBER }}>
                <b>{shipped ? '✓ ' : '⚠ '}{check.line}.</b>
                {shipped && <div style={{ color: '#524e46', marginTop: '3px' }}>It left the building without a shipment from this tab{docs.length > 1 ? ` — ${docs.length} packed pieces of this order are here` : ''}. Mark it shipped and it leaves Ready to Ship; no label is bought and nothing is sent to NetSuite.</div>}
                {err && <div style={{ color: '#9b2c2c', marginTop: '3px' }}>{err}</div>}
            </div>
            {shipped && canAct && (
                <button disabled={busy} onClick={mark}
                    style={{ padding: '9px 14px', background: GREEN, color: '#fff', border: `1px solid ${GREEN}`, fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {busy ? 'Marking…' : `✓ Shipped outside the app${docs.length > 1 ? ` (${docs.length})` : ''}`}
                </button>
            )}
            {shipped && !canAct && <span style={{ fontSize: '11px', color: '#524e46' }}>A manager marks it shipped.</span>}
        </div>
    );
}
