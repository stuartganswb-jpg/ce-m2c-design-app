// THE WMS FULFILMENT TAB — packed orders ship here: confirm the address, measure and weigh each
// package (a standard box is only the starting point — Stuart 2026-09-16: the new boxes are not in
// stock yet, so every dimension is editable), rate with UPS, choose the service, ship, print the
// label, and send the tracking back to the order, RTG and the NetSuite Item Fulfillment.
//
// S4's module, mounted ONCE in S3's PickPackApp (`activeTab === 'FULFILMENT'`). The rules live in
// Shared/fulfilment (pure, tested); the UPS calls are the upsRate / upsShip / upsVoid functions,
// which decide TEST vs LIVE on the server from system/ups_config — in TEST nothing is recorded.
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, getDocs, updateDoc, onSnapshot, query, collection, where, runTransaction, arrayUnion } from 'firebase/firestore';
import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { db, functions, storage } from '../../firebase';
import { enqueueNsWrite } from './nsOutbox';
import { propagateFloorState } from './orderLifecycle';
import { printHtmlDocument } from './labelPrint';
import {
    fulfilmentQueueOf, recentlyShippedOf, shipToOf, addressErrors, boxDims, blankPackage,
    packageErrors, sortedRates, rateOf, shipPatchOf, voidPatchOf, nsShipPayloadOf, labelDocHtml, boxSizeLabel,
    shipmentPackagesOf, shippedBoxesOf, rideAlongPatchOf, voidEffectsOf, soAfterVoid,
} from './fulfilment';
import { orderBoxesOf, boxHomeFor, boxShipStampsOf, boxesAfterVoid, boxOf, isBoxShipped } from './orderBoxes';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };
const NS_BASE = 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1';
const fmtUsd = (v) => (v === null || v === undefined) ? '—' : `$${Number(v).toFixed(2)}`;
const when = (t) => t ? new Date(Number(t)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const btn = (primary) => ({ padding: '9px 14px', background: primary ? theme.ink : 'transparent', color: primary ? '#fff' : theme.ink, border: `1px solid ${primary ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' });
const input = { padding: '8px 10px', border: `1px solid ${theme.line}`, background: '#fff', fontFamily: theme.sans, fontSize: '13px', outline: 'none', minWidth: 0 };
const errText = (e) => String((e && e.message) || e || 'Something went wrong.');

export default function FulfilmentPanel({ operator, activeBrand, docs = [], soIndex = {}, stdBoxes = [], isQsOrder, packRefOf, writeLog = () => {} }) {
    const [config, setConfig] = useState({ environment: 'CIE', rateDisplay: 'both' });
    const [selectedId, setSelectedId] = useState(null);
    const [address, setAddress] = useState(null);
    const [addressSource, setAddressSource] = useState('');
    const [packages, setPackages] = useState([]);
    // ONE PACKAGE PER NUMBERED BOX, AND A BOX SHIPS ONCE (Shared/fulfilment.shipmentPackagesOf, Stuart 2026-10-06):
    // `already` = this document's boxes that left on an earlier shipment; `rides` = every one of them has.
    const [already, setAlready] = useState([]);
    const [rides, setRides] = useState(false);
    const [rates, setRates] = useState(null);
    const [serviceCode, setServiceCode] = useState('');
    const [busy, setBusy] = useState('');
    const [note, setNote] = useState(null);

    useEffect(() => onSnapshot(doc(db, 'system', 'ups_config'),
        (s) => setConfig({ environment: 'CIE', rateDisplay: 'both', ...(s.exists() ? s.data() : {}) }), () => {}), []);

    const brandDocs = useMemo(() => docs.filter((d) => (d.brand || 'ce') === activeBrand), [docs, activeBrand]);
    const queue = useMemo(() => fulfilmentQueueOf(brandDocs), [brandDocs]);
    const shipped = useMemo(() => recentlyShippedOf(brandDocs), [brandDocs]);
    const brandBoxes = useMemo(() => stdBoxes.filter((b) => !b.brandId || b.brandId === 'global' || b.brandId === activeBrand), [stdBoxes, activeBrand]);
    const selected = queue.find((d) => d.id === selectedId) || null;
    const isLive = config.environment === 'PRODUCTION';

    const packDocRef = (d) => doc(db, isQsOrder(d) ? 'hq_sales_orders' : 'fin_workorders', d.id);
    const soOf = (d) => (isQsOrder(d) ? d : (soIndex[String(d.salesOrderId || '')] || soIndex[String(d.orderKey || '')] || null));
    // Where the order's numbered boxes live — the same resolver the pack bench writes them through.
    const boxHomeOf = (d) => boxHomeFor(d, { soIndex, isOrderDoc: isQsOrder });
    const boxesOf = (d) => orderBoxesOf(boxHomeOf(d).data);
    const writeBoxes = (d, change) => { const home = boxHomeOf(d); return runTransaction(db, async (tx) => {
        const ref = doc(db, home.coll, home.id);
        const snap = await tx.get(ref);
        if (snap.exists()) tx.update(ref, { orderBoxes: change(orderBoxesOf(snap.data())) });
    }); };

    // Choosing an order loads its ship-to (order → customer record) and its packages: one per numbered box
    // holding this document's pieces that has not already shipped, measured from the standard box where one is
    // on file (a document packed before box numbers: the two box types it recorded).
    const choose = async (d) => {
        setSelectedId(d.id); setRates(null); setServiceCode(''); setNote(null);
        const sp = shipmentPackagesOf({ doc: d, boxes: boxesOf(d), stdBoxes: brandBoxes });
        setPackages(sp.packages); setAlready(sp.already); setRides(sp.rides);
        const so = soOf(d);
        let customer = null;
        const custId = so && (so.customerId || (so.customer && so.customer.id));
        if (custId) {
            try { const cs = await getDoc(doc(db, 'crm_records', String(custId))); customer = cs.exists() ? cs.data() : null; } catch (e) { customer = null; }
        }
        const st = shipToOf(so, customer);
        setAddress(st.address); setAddressSource(st.source);
    };

    const setAddr = (k, v) => { setAddress((a) => ({ ...a, [k]: v })); setRates(null); setServiceCode(''); };
    const setPkg = (i, patch) => { setPackages((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setRates(null); setServiceCode(''); };
    const pickBox = (i, name) => {
        const box = brandBoxes.find((b) => b.name === name) || null;
        setPkg(i, box ? { boxName: box.name, ...boxDims(box), fromStandard: true } : { boxName: 'Custom box', fromStandard: false });
    };

    const problems = (selected && !rides) ? [...addressErrors(address).map((f) => `Ship-to: ${f}`), ...packageErrors(packages)] : [];

    const getRates = async () => {
        if (problems.length) return setNote({ ok: false, text: problems.join(' · ') });
        setBusy('rate'); setNote(null); setRates(null); setServiceCode('');
        try {
            const res = await httpsCallable(functions, 'upsRate')({ brand: activeBrand, shipTo: address, packages });
            setRates(res.data);
            if (!res.data.services.length) setNote({ ok: false, text: 'UPS returned no services for this address and package set.' });
        } catch (e) {
            setNote({ ok: false, text: errText(e) });
        } finally { setBusy(''); }
    };

    const printLabels = (images) => printHtmlDocument(labelDocHtml(images), { autoPrintDelay: 1200, timeout: 120000 });

    const sendShipToNetSuite = async (d, patch) => {
        const nsIfId = String(d.nsIfId || '');
        if (!nsIfId) {
            await updateDoc(packDocRef(d), { nsShipPending: true }).catch(() => {});
            return 'NetSuite: the Item Fulfillment has not posted yet — tracking waits here; send it from "Shipped recently" once it has.';
        }
        await enqueueNsWrite({
            kind: 'itemfulfillment-ship',
            label: `NS Ship — ${packRefOf(d)} · UPS ${patch.trackingNumbers.join(', ')}`,
            sourceApp: 'WMS', createdBy: operator?.name || '',
            targetUrl: `${NS_BASE}/itemFulfillment/${nsIfId}`,
            method: 'PATCH',
            payload: nsShipPayloadOf(patch),
            dedupeKey: `ship:${patch.shipmentId || `boxes:${d.id}:${patch.shippedAt}`}`,
            writeBack: { collection: isQsOrder(d) ? 'hq_sales_orders' : 'fin_workorders', docId: d.id, patch: { nsShipPosted: true, nsShipPending: false } },
        });
        await updateDoc(packDocRef(d), { nsShipQueued: true, nsShipPending: false }).catch(() => {});
        return 'NetSuite: the fulfillment update (status Shipped + tracking) is queued — watch 11.1 → NetSuite Sync Queue.';
    };

    // What every shipment record is followed by: the sales order, RTG, the NetSuite Item Fulfillment.
    const tellOrderRtgNetSuite = async (d, patch) => {
        const so = soOf(d);
        // THE SALES ORDER HOLDS EVERY TRACKING NUMBER of every shipment of the order (Stuart 2026-10-06) — this one's
        // are ADDED to its list (arrayUnion: two benches shipping two documents at once both land), never written over it.
        if (!isQsOrder(d) && so && so.id) await updateDoc(doc(db, 'hq_sales_orders', so.id), { shippedAt: patch.shippedAt, shipCarrier: 'UPS', shipService: patch.shipService, ...((patch.trackingNumbers || []).length ? { trackingNumbers: arrayUnion(...patch.trackingNumbers) } : {}) }).catch(() => {});
        try {
            await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { finWo: d, by: operator?.name || '', extra: { shippedAt: patch.shippedAt, trackingNumbers: patch.trackingNumbers, shipCarrier: 'UPS', shipService: patch.shipService } });
        } catch (e) { console.warn('RTG propagate failed (shipment stands):', e); }
        try { return await sendShipToNetSuite(d, patch); }
        catch (e) { await updateDoc(packDocRef(d), { nsShipPending: true }).catch(() => {}); return `⚠ NetSuite update NOT queued: ${e.message || e} — send it from "Shipped recently".`; }
    };

    // EVERY BOX OF THIS DOCUMENT HAS ALREADY SHIPPED (its pieces left in a box a sibling's shipment sent): there is
    // no label to buy. It is marked shipped IN those boxes — their tracking, no shipment of its own.
    const markShippedInBoxes = async () => {
        const d = selected;
        if (!d || !rides) return;
        if (!window.confirm(`Mark ${packRefOf(d)} shipped?\n\nEvery box holding its pieces has already shipped:\n${already.map((a) => `• Box ${a.no} — ${a.trackingNumber}${a.shippedWith ? ` (with ${a.shippedWith})` : ''}`).join('\n')}\n\nNo label is bought. The tracking goes onto this document, RTG and its NetSuite fulfillment.`)) return;
        setBusy('ship'); setNote(null);
        try {
            const patch = rideAlongPatchOf({ already, by: operator?.name || '' });
            await updateDoc(packDocRef(d), patch);
            const nsWords = await tellOrderRtgNetSuite(d, patch);
            writeLog(`Marked ${packRefOf(d)} shipped in ${already.map((a) => `Box ${a.no}`).join(', ')} · ${patch.trackingNumbers.join(', ')} (already shipped — no label)`, 'fulfilment');
            setSelectedId(null);
            setNote({ ok: true, text: `Marked shipped — tracking ${patch.trackingNumbers.join(', ')}. ${nsWords}` });
        } catch (e) {
            setNote({ ok: false, text: errText(e) });
        } finally { setBusy(''); }
    };

    const ship = async () => {
        const svc = rates && rates.services.find((s) => s.code === serviceCode);
        if (!svc) return setNote({ ok: false, text: 'Choose a service first.' });
        if (problems.length) return setNote({ ok: false, text: problems.join(' · ') });
        // A BOX SHIPS ONCE — checked again at the last moment: another bench may have shipped one of these boxes
        // with a sibling document since this order was chosen.
        const justGone = packages.filter((p) => p.boxNo && isBoxShipped(boxOf(boxesOf(selected), p.boxNo)));
        if (justGone.length) return setNote({ ok: false, text: `${justGone.map((p) => `Box ${p.boxNo}`).join(', ')} ${justGone.length === 1 ? 'has' : 'have'} just shipped with another document of this order. Choose ${packRefOf(selected)} again — it will be offered only the boxes still here.` });
        const price = rateOf(svc, config.rateDisplay);
        const envWords = isLive ? 'LIVE — this buys a real UPS label billed to the account' : 'TEST — a sample label only; nothing is recorded or billed';
        const goneWords = already.length ? `\n\nNOT in this shipment — already shipped: ${already.map((a) => `Box ${a.no} (${a.trackingNumber})`).join(', ')}.` : '';
        if (!window.confirm(`Ship ${packRefOf(selected)} by UPS ${svc.name} (${fmtUsd(price)})?\n\n${packages.length} package${packages.length === 1 ? '' : 's'}${packages.some((p) => p.boxNo) ? ` (${packages.map((p) => (p.boxNo ? `Box ${p.boxNo}` : 'extra')).join(', ')})` : ''} to ${address.addressee || address.attention}, ${address.city} ${address.state}${goneWords}\n\n${envWords}.`)) return;
        setBusy('ship'); setNote(null);
        const d = selected;
        try {
            const res = await httpsCallable(functions, 'upsShip')({ brand: activeBrand, shipTo: address, packages, serviceCode, reference: packRefOf(d) });
            const r = res.data;
            const images = r.packages.map((p) => (p.labelGif ? `data:image/gif;base64,${p.labelGif}` : '')).filter(Boolean);
            if (r.environment !== 'PRODUCTION') {
                printLabels(images);
                writeLog(`UPS TEST label for ${packRefOf(d)} (${r.serviceName}, ${r.packages.map((p) => p.trackingNumber).join(', ')}) — nothing recorded`, 'fulfilment');
                setNote({ ok: true, text: `TEST label made (shipment ${r.shipmentId}). Nothing was recorded on the order or sent to NetSuite — switch UPS to LIVE in HQ 9.5 to ship for real.` });
                return;
            }
            // LIVE: keep the labels, stamp the order, tell RTG, update NetSuite, print.
            const labelUrls = [];
            for (let i = 0; i < r.packages.length; i++) {
                const p = r.packages[i];
                if (!p.labelGif) { labelUrls.push(''); continue; }
                try {
                    const sref = storageRef(storage, `ups_labels/${r.shipmentId}/${i + 1}-${p.trackingNumber || 'label'}.gif`);
                    await uploadString(sref, p.labelGif, 'base64', { contentType: 'image/gif' });
                    labelUrls.push(await getDownloadURL(sref));
                } catch (e) { labelUrls.push(''); console.warn('label upload failed (label still prints):', e); }
            }
            const patch = shipPatchOf({ result: r, packages, labelUrls, by: operator?.name || '', already });
            await updateDoc(packDocRef(d), { ...patch, shipTo: address });
            // A BOX SHIPS ONCE: each numbered box this shipment sent carries its tracking on the order's box list,
            // so a later document of the order is not offered it again and SO Pack shows it per box.
            let boxWords = '';
            const sent = shippedBoxesOf(patch);
            if (sent.length) {
                try { await writeBoxes(d, (list) => boxShipStampsOf(list, sent, { shipmentId: patch.shipmentId, shipService: patch.shipService, by: operator?.name || '', now: patch.shippedAt, withRef: packRefOf(d), withDocId: d.id })); }
                catch (e) { boxWords = ` ⚠ The order's boxes were NOT marked shipped (${e.message || e}) — tell Stuart: ${sent.map((b) => `Box ${b.no} ${b.trackingNumber}`).join(', ')}.`; }
            }
            const nsWords = await tellOrderRtgNetSuite(d, patch);
            writeLog(`Shipped ${packRefOf(d)} UPS ${patch.shipService} · ${patch.trackingNumbers.join(', ')}${sent.length ? ` · ${sent.map((b) => `Box ${b.no}`).join(', ')}` : ''} · ${fmtUsd(r.negotiated ?? r.published)}`, 'fulfilment');
            printLabels(images);
            setSelectedId(null); setRates(null); setServiceCode('');
            setNote({ ok: true, text: `Shipped — tracking ${patch.trackingNumbers.join(', ')}. ${nsWords}${boxWords}` });
        } catch (e) {
            setNote({ ok: false, text: errText(e) });
        } finally { setBusy(''); }
    };

    const reprint = (d) => printLabels((d.shipPackages || []).map((p) => p.labelUrl).filter(Boolean));

    const voidShipment = async (d) => {
        // A VOID UN-SHIPS ITS BOXES (Shared/fulfilment.voidEffectsOf): they are packed-and-waiting again, and any
        // other document of the order that travels in one of them loses that tracking — one with no label of its
        // own returns to the ship queue.
        const sibs = isQsOrder(d) ? [] : docs.filter((x) => x && x.id !== d.id && !isQsOrder(x) && ((d.orderKey && x.orderKey === d.orderKey) || (d.salesOrderId && x.salesOrderId === d.salesOrderId)));
        const fx = voidEffectsOf({ doc: d, boxes: boxesOf(d), siblings: sibs, by: operator?.name || '' });
        const sibWords = fx.siblings.length ? `\n\nAlso on this order:\n${fx.siblings.map((x) => { const sd = sibs.find((y) => y.id === x.id); return `• ${packRefOf(sd)} ${x.kind === 'RETURN' ? 'travelled in a box of this shipment — it returns to the ship queue' : 'loses the tracking of the box that was in this shipment'}`; }).join('\n')}` : '';
        const nsSent = d.nsShipQueued || d.nsShipPosted || fx.siblings.some((x) => { const sd = sibs.find((y) => y.id === x.id); return sd && (sd.nsShipQueued || sd.nsShipPosted); });
        if (!window.confirm(`Void UPS shipment ${d.shipmentId} for ${packRefOf(d)}?\n\nThe label(s) stop working and the order returns to the ship queue.${sibWords}${nsSent ? '\n\n⚠ NetSuite was already sent this tracking — the fulfillment in NetSuite must be corrected by hand (remove the package line, set status back to Packed).' : ''}`)) return;
        setBusy(`void:${d.id}`); setNote(null);
        try {
            await httpsCallable(functions, 'upsVoid')({ brand: activeBrand, shipmentId: d.shipmentId, environment: d.shipEnvironment });
            await updateDoc(packDocRef(d), voidPatchOf({ by: operator?.name || '', prior: d }));
            if (fx.changed) await writeBoxes(d, (list) => boxesAfterVoid(list, d.shipmentId));
            for (const x of fx.siblings) {
                const sd = sibs.find((y) => y.id === x.id);
                await updateDoc(packDocRef(sd), x.patch);
                try {
                    await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                        { finWo: sd, by: operator?.name || '', extra: x.kind === 'RETURN' ? { shippedAt: null, trackingNumbers: [] } : { trackingNumbers: x.patch.trackingNumbers } });
                } catch (e) { console.warn('RTG propagate failed (void stands):', e); }
            }
            // The sales order loses only THIS shipment's tracking; what the order's other documents shipped stays on it,
            // and it reads un-shipped only when nothing of the order is shipped any more.
            const so = soOf(d);
            if (!isQsOrder(d) && so && so.id) await updateDoc(doc(db, 'hq_sales_orders', so.id), soAfterVoid({ so, doc: d, siblings: sibs, returnedIds: fx.siblings.filter((x) => x.kind === 'RETURN').map((x) => x.id) })).catch(() => {});
            try {
                await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                    { finWo: d, by: operator?.name || '', extra: { shippedAt: null, trackingNumbers: [] } });
            } catch (e) { console.warn('RTG propagate failed (void stands):', e); }
            writeLog(`Voided UPS ${d.shipmentId} for ${packRefOf(d)}`, 'fulfilment');
            setNote({ ok: true, text: `Voided ${d.shipmentId}. ${packRefOf(d)} is back in the ship queue.` });
        } catch (e) {
            setNote({ ok: false, text: errText(e) });
        } finally { setBusy(''); }
    };

    const resendNetSuite = async (d) => {
        setBusy(`ns:${d.id}`); setNote(null);
        try { setNote({ ok: true, text: await sendShipToNetSuite(d, d) }); } catch (e) { setNote({ ok: false, text: e.message || String(e) }); } finally { setBusy(''); }
    };

    const rateRows = rates ? sortedRates(rates.services, config.rateDisplay) : [];
    const label = { fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.inkSoft };

    return (
        <div style={{ fontFamily: theme.sans, color: theme.ink }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <h2 style={{ fontFamily: theme.serif, fontWeight: 500, fontSize: '1.6rem', margin: 0 }}>Fulfillment</h2>
                <span style={{ padding: '3px 8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', background: isLive ? '#3a7d44' : '#9b6a2c', color: '#fff' }}>
                    UPS {isLive ? 'LIVE' : 'TEST MODE'}
                </span>
                {!isLive && <span style={{ fontSize: '12px', color: theme.inkSoft }}>Rates and labels are samples; shipping records nothing. An admin switches to LIVE in HQ → 9.5.</span>}
            </div>

            {note && <div style={{ padding: '10px 12px', marginBottom: '14px', border: `1px solid ${note.ok ? '#3a7d44' : '#9b2c2c'}`, color: note.ok ? '#3a7d44' : '#9b2c2c', background: '#fff', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{note.text}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: '18px', alignItems: 'start' }}>
                {/* THE QUEUE */}
                <div style={{ border: `1px solid ${theme.line}`, background: '#fff' }}>
                    <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.line}`, ...label }}>Ready to ship · {queue.length}</div>
                    {queue.length === 0 && <div style={{ padding: '14px 12px', fontSize: '13px', color: theme.inkSoft }}>Nothing packed is waiting to ship.</div>}
                    {queue.map((d) => (
                        <button key={d.id} onClick={() => choose(d)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: `1px solid ${theme.line}`, background: d.id === selectedId ? theme.paper2 : '#fff', cursor: 'pointer' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '12px' }}>{packRefOf(d)}</div>
                            <div style={{ fontSize: '12px', color: theme.inkSoft }}>{d.customerName || d.clientName || d.customer || ''}</div>
                            <div style={{ fontSize: '11px', color: theme.inkSoft }}>Packed {when(d.packedAt)}{d.packedBy ? ` · ${d.packedBy}` : ''}{d.nsIfTran ? ` · IF ${d.nsIfTran}` : (d.nsFulfillQueued ? ' · IF queued' : '')}</div>
                        </button>
                    ))}
                </div>

                {/* THE SHIPMENT */}
                <div>
                    {!selected && <div style={{ padding: '18px', border: `1px dashed ${theme.line}`, color: theme.inkSoft, fontSize: '13px' }}>Choose a packed order on the left to ship it.</div>}
                    {selected && address && (
                        <div style={{ border: `1px solid ${theme.line}`, background: '#fff', padding: '16px' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '13px', marginBottom: '12px' }}>{packRefOf(selected)} — {selected.customerName || selected.clientName || selected.customer || ''}</div>

                            <div style={label}>Ship to <span style={{ textTransform: 'none', letterSpacing: 0 }}>({addressSource})</span></div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', margin: '6px 0 8px' }}>
                                <input style={input} placeholder="Company / name" value={address.addressee} onChange={(e) => setAddr('addressee', e.target.value)} />
                                <input style={input} placeholder="Attention" value={address.attention} onChange={(e) => setAddr('attention', e.target.value)} />
                                <input style={input} placeholder="Phone" value={address.phone} onChange={(e) => setAddr('phone', e.target.value)} />
                                <input style={input} placeholder="Street" value={address.addr1} onChange={(e) => setAddr('addr1', e.target.value)} />
                                <input style={input} placeholder="Suite / unit" value={address.addr2} onChange={(e) => setAddr('addr2', e.target.value)} />
                                <input style={input} placeholder="City" value={address.city} onChange={(e) => setAddr('city', e.target.value)} />
                                <input style={input} placeholder="State" value={address.state} onChange={(e) => setAddr('state', e.target.value.toUpperCase())} />
                                <input style={input} placeholder="Zip" value={address.zip} onChange={(e) => setAddr('zip', e.target.value)} />
                            </div>
                            <label style={{ fontSize: '12px', color: theme.inkSoft, display: 'inline-flex', gap: '6px', alignItems: 'center', marginBottom: '14px' }}>
                                <input type="checkbox" checked={!!address.residential} onChange={(e) => setAddr('residential', e.target.checked)} /> Residential address
                            </label>

                            {already.length > 0 && (
                                <div style={{ margin: '0 0 12px', padding: '8px 10px', background: theme.paper, borderLeft: '3px solid #3a7d44', fontSize: '12px' }}>
                                    <b>Already shipped — not in this shipment:</b> {already.map((a) => `Box ${a.no}${a.boxName ? ` · ${a.boxName}` : ''} — ${a.trackingNumber}${a.shippedWith ? ` (with ${a.shippedWith})` : ''}`).join(' · ')}
                                </div>
                            )}
                            {rides ? (
                                <div style={{ padding: '14px', border: `1px solid ${theme.line}`, background: theme.paper }}>
                                    <div style={{ fontSize: '13px', marginBottom: '10px' }}>Every box holding this document's pieces has already shipped — there is no label to buy.</div>
                                    <button style={{ ...btn(true), background: '#3a7d44', borderColor: '#3a7d44' }} disabled={busy === 'ship'} onClick={markShippedInBoxes}>{busy === 'ship' ? 'Marking…' : 'Mark shipped — in those boxes'}</button>
                                </div>
                            ) : (<>
                            <div style={label}>Packages — one per numbered box; dimensions in inches, weight in lb; every field can be changed</div>
                            <div style={{ overflowX: 'auto', margin: '6px 0 8px' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>
                                    <thead><tr style={{ textAlign: 'left', color: theme.inkSoft }}>
                                        <th style={{ padding: '4px' }}>#</th><th style={{ padding: '4px' }}>Box</th><th style={{ padding: '4px' }}>L</th><th style={{ padding: '4px' }}>W</th><th style={{ padding: '4px' }}>H</th><th style={{ padding: '4px' }}>Weight</th><th />
                                    </tr></thead>
                                    <tbody>
                                        {packages.map((p, i) => (
                                            <tr key={i}>
                                                <td style={{ padding: '4px', fontFamily: theme.mono, whiteSpace: 'nowrap' }}>{p.boxNo ? `Box ${p.boxNo}` : i + 1}</td>
                                                <td style={{ padding: '4px' }}>
                                                    <select style={{ ...input, width: '100%' }} value={brandBoxes.some((b) => b.name === p.boxName) ? p.boxName : ''} onChange={(e) => pickBox(i, e.target.value)}>
                                                        <option value="">{p.fromStandard ? 'Custom box' : (p.boxName || 'Custom box')}</option>
                                                        {brandBoxes.map((b) => <option key={b.id} value={b.name}>{b.name} — {boxSizeLabel(b)}</option>)}
                                                    </select>
                                                </td>
                                                {['length', 'width', 'height', 'weight'].map((k) => (
                                                    <td key={k} style={{ padding: '4px' }}>
                                                        <input style={{ ...input, width: '64px' }} inputMode="decimal" value={p[k]} onChange={(e) => setPkg(i, { [k]: e.target.value.replace(/[^0-9.]/g, ''), ...(k !== 'weight' ? { fromStandard: false } : {}) })} />
                                                    </td>
                                                ))}
                                                <td style={{ padding: '4px' }}>
                                                    {/* A numbered box holds this document's pieces — it ships with it. Only an extra package can be dropped. */}
                                                    {!p.boxNo && packages.length > 1 && <button style={btn(false)} onClick={() => { setPackages((rows) => rows.filter((_, j) => j !== i)); setRates(null); setServiceCode(''); }}>Remove</button>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <button style={btn(false)} onClick={() => { setPackages((rows) => [...rows, blankPackage()]); setRates(null); setServiceCode(''); }}>+ Add package</button>

                            {problems.length > 0 && <div style={{ marginTop: '12px', fontSize: '12px', color: '#9b6a2c' }}>Still needed: {problems.join(' · ')}</div>}

                            <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <button style={btn(true)} disabled={busy === 'rate'} onClick={getRates}>{busy === 'rate' ? 'Getting rates…' : 'Get UPS rates'}</button>
                            </div>

                            {rates && rateRows.length > 0 && (
                                <div style={{ marginTop: '14px', overflowX: 'auto' }}>
                                    <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: theme.mono, fontSize: '12px' }}>
                                        <thead><tr style={{ textAlign: 'left', color: theme.inkSoft, borderBottom: `1px solid ${theme.line}` }}>
                                            <th style={{ padding: '6px' }} /><th style={{ padding: '6px' }}>Service</th>
                                            {config.rateDisplay !== 'published' && <th style={{ padding: '6px', textAlign: 'right' }}>Negotiated</th>}
                                            {config.rateDisplay !== 'negotiated' && <th style={{ padding: '6px', textAlign: 'right' }}>Published</th>}
                                            <th style={{ padding: '6px', textAlign: 'right' }}>Bus. days</th>
                                        </tr></thead>
                                        <tbody>
                                            {rateRows.map((s) => (
                                                <tr key={s.code} onClick={() => setServiceCode(s.code)} style={{ cursor: 'pointer', background: serviceCode === s.code ? theme.paper2 : 'transparent', borderBottom: `1px solid ${theme.line}` }}>
                                                    <td style={{ padding: '6px' }}><input type="radio" readOnly checked={serviceCode === s.code} /></td>
                                                    <td style={{ padding: '6px' }}>{s.name}</td>
                                                    {config.rateDisplay !== 'published' && <td style={{ padding: '6px', textAlign: 'right' }}>{fmtUsd(s.negotiated)}</td>}
                                                    {config.rateDisplay !== 'negotiated' && <td style={{ padding: '6px', textAlign: 'right' }}>{fmtUsd(s.published)}</td>}
                                                    <td style={{ padding: '6px', textAlign: 'right' }}>{s.businessDays || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {(rates.alerts || []).length > 0 && <div style={{ marginTop: '6px', fontSize: '11px', color: theme.inkSoft }}>UPS notes: {rates.alerts.join(' · ')}</div>}
                                    <div style={{ marginTop: '12px' }}>
                                        <button style={{ ...btn(true), background: isLive ? '#3a7d44' : theme.ink, borderColor: isLive ? '#3a7d44' : theme.ink }} disabled={!serviceCode || busy === 'ship'} onClick={ship}>
                                            {busy === 'ship' ? 'Shipping…' : (isLive ? 'Ship & print label' : 'Make TEST label')}
                                        </button>
                                    </div>
                                </div>
                            )}
                            </>)}
                        </div>
                    )}

                    {/* SHIPPED RECENTLY */}
                    <div style={{ marginTop: '22px', border: `1px solid ${theme.line}`, background: '#fff' }}>
                        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.line}`, ...label }}>Shipped recently · {shipped.length}</div>
                        {shipped.length === 0 && <div style={{ padding: '14px 12px', fontSize: '13px', color: theme.inkSoft }}>Nothing shipped in the last 3 days.</div>}
                        {shipped.map((d) => (
                            <div key={d.id} style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.line}`, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{ marginRight: 'auto', fontSize: '12px' }}>
                                    <span style={{ fontFamily: theme.mono }}>{packRefOf(d)}</span> · UPS {d.shipService} · {(d.shipPackages || []).some((p) => p.boxNo) ? (d.shipPackages || []).map((p) => `${p.boxNo ? `Box ${p.boxNo} ` : ''}${p.trackingNumber}${p.shippedEarlier ? ' (shipped earlier)' : ''}`).join(', ') : (d.trackingNumbers || []).join(', ')}
                                    <div style={{ fontSize: '11px', color: theme.inkSoft }}>
                                        {when(d.shippedAt)}{d.shippedBy ? ` · ${d.shippedBy}` : ''} · {d.nsShipPosted ? 'NetSuite updated' : (d.nsShipQueued ? 'NetSuite update queued' : (d.nsShipPending ? 'NetSuite waiting' : ''))}
                                    </div>
                                </div>
                                {(d.shipPackages || []).some((p) => p.labelUrl) && <button style={btn(false)} onClick={() => reprint(d)}>Reprint</button>}
                                {d.nsShipPending && d.nsIfId && <button style={btn(false)} disabled={busy === `ns:${d.id}`} onClick={() => resendNetSuite(d)}>Send to NetSuite</button>}
                                {d.shipmentId && <button style={btn(false)} disabled={busy === `void:${d.id}`} onClick={() => voidShipment(d)}>{busy === `void:${d.id}` ? 'Voiding…' : 'Void'}</button>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
