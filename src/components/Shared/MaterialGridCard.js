// ── THE ONE RENDERER OF THE MATERIAL GRID (Stuart 2026-09-23) ──────────────────────────────
// Drawn on the finishing setup card, the shop card and the WMS pick card from the SAME rows the
// release stamped (Shared/materialGrid). It reads the document; it never reads NetSuite. Fonts and
// colours fall back explicitly because the three floor apps do not all define the HQ CSS variables.
import React from 'react';
import { MATERIAL_STATE, materialAgeText, pickDoneOf, pickedRowsOf, PICK_STATE } from './materialGrid';
import { packReadinessOf } from './orderStatus';

const MONO = 'var(--mono, ui-monospace, Menlo, monospace)';
const SANS = 'var(--sans, -apple-system, Helvetica, Arial, sans-serif)';
const INK = 'var(--ink, #1a1a1a)';
const SOFT = 'var(--ink-soft, #7a7a7a)';
const LINE = 'var(--line, #e2ddd2)';
const RED = '#b02d20', GREEN = '#2e7d32';

const tone = (state) => (state === MATERIAL_STATE.SHORT ? RED : state === MATERIAL_STATE.COVERED ? GREEN : SOFT);
const num = (v) => (v == null ? '—' : String(v));
const PICK_WORD = {
    [PICK_STATE.PICKED]: '✔ picked', [PICK_STATE.SHORT_AT_PICK]: '⚠ short at the pick', [PICK_STATE.SKIPPED]: '⚠ skipped at the pick',
    [PICK_STATE.CLEARED]: 'pull cleared by hand in the WMS', [PICK_STATE.NOT_ON_PICK]: 'not a pick line (made or cut for the order)',
};
const pickTone = (st) => (st === PICK_STATE.PICKED ? GREEN : st === PICK_STATE.SHORT_AT_PICK || st === PICK_STATE.SKIPPED ? RED : SOFT);

// ── WHERE THE ORDER IS, IN ONE LINE (Stuart 2026-09-30: "it should not be seen as available to pack unless it is
// available to pack"). The same rule as the WMS pack queue (Shared/orderStatus.packReadinessOf): READY TO PACK only
// when finishing is complete and the custom half is in; otherwise what it waits on, stage by stage.
const PackVerdict = ({ d }) => {
    const v = packReadinessOf(d);
    if (!v) return null;
    const colour = v.ready ? GREEN : v.done ? SOFT : RED;
    return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 10px', borderBottom: `1px solid ${LINE}`, background: v.ready ? '#f1f8f2' : v.done ? '#faf9f6' : '#fdf3f2' }}>
            <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '.06em', color: colour, whiteSpace: 'nowrap' }}>{v.ready ? '✔' : v.done ? '■' : '⛔'} {v.word}</span>
            <span style={{ fontFamily: SANS, fontSize: '0.78rem', color: v.ready || v.done ? SOFT : INK }}>{v.reason}</span>
        </div>
    );
};

/**
 * @param doc    any document carrying materialRows / materialAsOf / materialRefreshedAt
 * @param title  the strip heading
 * @param style  wrapper overrides
 */
const MaterialGrid = ({ doc: d, title = 'Material · on hand vs need', style = {} }) => {
    const rows = (d && Array.isArray(d.materialRows)) ? d.materialRows : [];
    if (!rows.length) return null;
    if (pickDoneOf(d)) return <PickedGrid d={d} style={style} />;
    const shorts = rows.filter(r => r.state === MATERIAL_STATE.SHORT).length;
    const unverified = rows.filter(r => r.state === MATERIAL_STATE.UNVERIFIED).length;
    const asOf = d.materialRefreshedAt || d.materialAsOf;
    const th = { fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT, padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}` };
    const td = { fontFamily: MONO, fontSize: '11px', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' };
    return (
        <div style={{ marginTop: '10px', border: `1px solid ${shorts ? RED : LINE}`, background: '#fff', borderRadius: '2px', ...style }}>
            <PackVerdict d={d} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', padding: '8px 10px 4px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT }}>{title}</span>
                <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '.05em', color: shorts ? RED : unverified ? SOFT : GREEN }}>
                    {shorts ? `⚠ ${shorts} SHORT` : unverified ? `${unverified} UNVERIFIED` : '✓ ALL ON HAND (stock, not packing)'}
                </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ ...th, textAlign: 'left' }}>Part</th>
                            <th style={th}>Need</th>
                            <th style={th}>On hand</th>
                            <th style={th}>Short</th>
                            <th style={th}>On order</th>
                            <th style={{ ...th, textAlign: 'left', whiteSpace: 'normal' }}>Covered by</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => {
                            const c = tone(r.state);
                            return (
                                <tr key={r.code} style={{ background: r.state === MATERIAL_STATE.SHORT ? '#fdf3f2' : 'transparent' }}>
                                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: '140px' }}>
                                        <span style={{ fontWeight: 700, color: INK }}>{r.code}</span>
                                        {r.name ? <div style={{ fontFamily: SANS, fontSize: '0.74rem', color: SOFT }}>{r.name}</div> : null}
                                    </td>
                                    <td style={{ ...td, color: INK }}>{num(r.need)}{r.unit ? <span style={{ color: SOFT }}> {r.unit}</span> : null}</td>
                                    <td style={{ ...td, color: c, fontWeight: 700 }}>{num(r.onHand)}</td>
                                    <td style={{ ...td, color: r.short ? RED : SOFT, fontWeight: r.short ? 700 : 400 }}>{r.short == null ? '—' : (r.short || '0')}</td>
                                    <td style={{ ...td, color: SOFT }}>{r.onOrder ? r.onOrder : '—'}</td>
                                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', color: r.state === MATERIAL_STATE.SHORT ? INK : SOFT, fontSize: '10px', minWidth: '160px' }}>{r.coveredBy || (r.state === MATERIAL_STATE.COVERED ? '✔ on hand' : '')}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div style={{ fontFamily: MONO, fontSize: '9px', color: SOFT, padding: '4px 10px 6px', letterSpacing: '.03em' }}>
                stock as of {asOf ? `${new Date(asOf).toLocaleString()} · ${materialAgeText(asOf)}` : 'release'}{d.materialRefreshedAt ? ' · refreshed by RTG' : ' · at release'} · RTG refreshes every morning until the parts are pulled
            </div>
        </div>
    );
};

// ── AFTER THE PICK (Stuart 2026-09-30, SO60676) — what the pick TOOK, from its own records (Shared/materialGrid
// .pickedRowsOf). The morning stock read stops once the parts are pulled, so its numbers are history by now; showing
// them made a fully picked order look short.
const PickedGrid = ({ d, style = {} }) => {
    const rows = pickedRowsOf(d);
    const bad = rows.filter(r => r.pickState === PICK_STATE.SHORT_AT_PICK || r.pickState === PICK_STATE.SKIPPED).length;
    const cleared = rows.some(r => r.pickState === PICK_STATE.CLEARED);
    const th = { fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT, padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}` };
    const td = { fontFamily: MONO, fontSize: '11px', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' };
    const when = d.pickedAt ? new Date(d.pickedAt).toLocaleString() : '';
    return (
        <div style={{ marginTop: '10px', border: `1px solid ${bad ? RED : LINE}`, background: '#fff', borderRadius: '2px', ...style }}>
            <PackVerdict d={d} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', padding: '8px 10px 4px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT }}>Material · what the pick took</span>
                <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '.05em', color: bad ? RED : cleared ? SOFT : GREEN }}>
                    {bad ? `⚠ ${bad} SHORT OR SKIPPED AT THE PICK` : cleared ? 'PULL CLEARED BY HAND' : '✔ ALL PICKED'}
                </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ ...th, textAlign: 'left' }}>Part</th>
                            <th style={th}>Need</th>
                            <th style={th}>Picked</th>
                            <th style={th}>Short at pick</th>
                            <th style={{ ...th, textAlign: 'left', whiteSpace: 'normal' }}>Pick</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.code} style={{ background: r.shortAtPick ? '#fdf3f2' : 'transparent' }}>
                                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: '140px' }}>
                                    <span style={{ fontWeight: 700, color: INK }}>{r.code}</span>
                                    {r.name ? <div style={{ fontFamily: SANS, fontSize: '0.74rem', color: SOFT }}>{r.name}</div> : null}
                                </td>
                                <td style={{ ...td, color: INK }}>{num(r.target != null ? r.target : r.need)}{r.unit ? <span style={{ color: SOFT }}> {r.unit}</span> : null}</td>
                                <td style={{ ...td, color: pickTone(r.pickState), fontWeight: 700 }}>{num(r.picked)}</td>
                                <td style={{ ...td, color: r.shortAtPick ? RED : SOFT, fontWeight: r.shortAtPick ? 700 : 400 }}>{r.picked == null ? '—' : (r.shortAtPick || '0')}</td>
                                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', color: pickTone(r.pickState), fontSize: '10px', minWidth: '160px' }}>{PICK_WORD[r.pickState] || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div style={{ fontFamily: MONO, fontSize: '9px', color: SOFT, padding: '4px 10px 6px', letterSpacing: '.03em' }}>
                {cleared ? 'pull cleared by hand' : `picked${when ? ` ${when}` : ''}${d.pickedBy ? ` by ${d.pickedBy}` : ''}`} · stock is no longer read once the parts are pulled
            </div>
        </div>
    );
};

export default MaterialGrid;
