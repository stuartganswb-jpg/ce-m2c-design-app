// ── THE ONE RENDERER OF THE MATERIAL GRID (Stuart 2026-09-23) ──────────────────────────────
// Drawn on the finishing setup card, the shop card and the WMS pick card from the SAME rows the
// release stamped (Shared/materialGrid). It reads the document; it never reads NetSuite. Fonts and
// colours fall back explicitly because the three floor apps do not all define the HQ CSS variables.
import React from 'react';
import { MATERIAL_STATE, materialAgeText } from './materialGrid';

const MONO = 'var(--mono, ui-monospace, Menlo, monospace)';
const SANS = 'var(--sans, -apple-system, Helvetica, Arial, sans-serif)';
const INK = 'var(--ink, #1a1a1a)';
const SOFT = 'var(--ink-soft, #7a7a7a)';
const LINE = 'var(--line, #e2ddd2)';
const RED = '#b02d20', GREEN = '#2e7d32';

const tone = (state) => (state === MATERIAL_STATE.SHORT ? RED : state === MATERIAL_STATE.COVERED ? GREEN : SOFT);
const num = (v) => (v == null ? '—' : String(v));

/**
 * @param doc    any document carrying materialRows / materialAsOf / materialRefreshedAt
 * @param title  the strip heading
 * @param style  wrapper overrides
 */
const MaterialGrid = ({ doc: d, title = 'Material · on hand vs need', style = {} }) => {
    const rows = (d && Array.isArray(d.materialRows)) ? d.materialRows : [];
    if (!rows.length) return null;
    const shorts = rows.filter(r => r.state === MATERIAL_STATE.SHORT).length;
    const unverified = rows.filter(r => r.state === MATERIAL_STATE.UNVERIFIED).length;
    const asOf = d.materialRefreshedAt || d.materialAsOf;
    const th = { fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT, padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}` };
    const td = { fontFamily: MONO, fontSize: '11px', padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' };
    return (
        <div style={{ marginTop: '10px', border: `1px solid ${shorts ? RED : LINE}`, background: '#fff', borderRadius: '2px', ...style }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', padding: '8px 10px 4px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: SOFT }}>{title}</span>
                <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '.05em', color: shorts ? RED : unverified ? SOFT : GREEN }}>
                    {shorts ? `⚠ ${shorts} SHORT` : unverified ? `${unverified} UNVERIFIED` : '✓ ALL ON HAND'}
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

export default MaterialGrid;
