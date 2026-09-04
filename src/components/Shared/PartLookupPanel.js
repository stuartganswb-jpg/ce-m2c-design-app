// PART LOOKUP PANEL — the read-only search bar. Type a part number, ours or theirs.
//
// Stuart 2026-09-03: "it does not actually enter any data, on display it to help the cpq decisions"
// and "it would also be a great tool to check so above can be fixed when it occurs" — the "above"
// being CE-INV-60175, the 4-5/8" in-line bracket carrying a 3.625" projection tag, which took an
// hour to find by hand and reads as one line here.
//
// ⚠ NOTHING IN THIS FILE WRITES, SELECTS, OR NAVIGATES. No onChange into the configurator, no
// launchFlow, no cart. It renders what partLookup reports and stops. If a future change needs it to
// DO something, that is a different component — this one's value is that an operator can hammer it
// mid-quote without the risk of nudging the order.

import React, { useMemo, useState } from 'react';
import { searchLookup, verdictFor, tagLinesOf } from './partLookup.js';

const mono = { fontFamily: 'var(--mono)', letterSpacing: '.04em' };

export default function PartLookupPanel({
    index = [],
    choices = [],
    answers = {},
    customerName = '',
    compact = false,
    loading = false,
    // Fired once, on first focus. The cross-flow index costs a read per assembly, so the tab that
    // needs one builds it when somebody actually searches rather than on every visit to the page.
    onFirstUse = null,
    placeholder = 'Part # — theirs or ours (e.g. H3553F, H1-75ILE)',
}) {
    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const [woken, setWoken] = useState(false);

    const wake = () => {
        setOpen(true);
        if (woken) return;
        setWoken(true);
        if (typeof onFirstUse === 'function') onFirstUse();
    };

    const hits = useMemo(() => searchLookup(term, index), [term, index]);
    const live = choices.length > 0;

    const box = {
        width: '100%', padding: compact ? '8px 10px' : '11px 12px',
        border: '1px solid var(--line)', background: '#fff',
        fontFamily: 'var(--sans)', fontSize: compact ? '.85rem' : '.9rem', outline: 'none',
    };

    return (
        <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ ...mono, fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                    🔎 Look up
                </span>
                <input
                    value={term}
                    onChange={(e) => { setTerm(e.target.value); wake(); }}
                    onFocus={wake}
                    placeholder={placeholder}
                    style={box}
                    aria-label="Look up a part number"
                />
                {term && (
                    <button
                        onClick={() => { setTerm(''); setOpen(false); }}
                        style={{ ...mono, fontSize: '9px', textTransform: 'uppercase', padding: '6px 9px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}
                    >clear</button>
                )}
            </div>

            <div style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)', marginTop: '5px', textTransform: 'uppercase' }}>
                Reference only — nothing here changes the order
                {customerName ? ` · their numbers shown for ${customerName}` : ' · pick a customer to see their part numbers'}
            </div>

            {open && term.trim().length >= 2 && (
                <div style={{
                    marginTop: '8px', border: '1px solid var(--line)', background: '#fff',
                    maxHeight: compact ? '260px' : '340px', overflowY: 'auto',
                }}>
                    {(loading || !index.length) && (
                        <div style={{ padding: '14px', ...mono, fontSize: '10px', color: 'var(--ink-soft)' }}>
                            {loading ? 'Reading the catalogue…' : 'No catalogue loaded for this search.'}
                        </div>
                    )}
                    {!loading && !!index.length && !hits.length && (
                        <div style={{ padding: '14px', ...mono, fontSize: '10px', color: 'var(--ink-soft)' }}>
                            No part matches “{term.trim()}”. Their code only resolves once the item carries a
                            Fabricut pattern # or a per-customer row in 4.6.
                        </div>
                    )}
                    {!loading && hits.map(row => {
                        const verdict = live ? verdictFor(row, { choices, answers }) : null;
                        const blocked = verdict && verdict.ok === false;
                        return (
                            <div key={row.key} style={{ padding: '11px 13px', borderBottom: '1px solid var(--line)' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px', flexWrap: 'wrap' }}>
                                    <span style={{ ...mono, fontSize: '11px', color: 'var(--ink)', fontWeight: 600 }}>{row.ours || '—'}</span>
                                    {row.theirs && (
                                        <span style={{ ...mono, fontSize: '10px', color: 'var(--brass)' }}>{row.theirs}</span>
                                    )}
                                    {row.hidden && (
                                        <span style={{ ...mono, fontSize: '8px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>· bom only</span>
                                    )}
                                </div>
                                <div style={{ fontFamily: 'var(--sans)', fontSize: '.83rem', color: 'var(--ink)', marginTop: '2px' }}>
                                    {row.name}
                                </div>

                                {/* WHICH FLOW — the question at the top of the page. */}
                                <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '5px', textTransform: 'uppercase' }}>
                                    {row.flowGroup ? `${row.flowGroup} → ${row.flowChoice || row.flowName}` : (row.flowName || 'unlinked flow')}
                                    {row.role ? ` · ${row.role.replace(/_/g, ' ').toLowerCase()}` : ''}
                                </div>

                                {/* THE TAGS — the question at the bracket step. */}
                                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
                                    {tagLinesOf(row).map(t => (
                                        <span key={t.key} style={{
                                            ...mono, fontSize: '8.5px', textTransform: 'uppercase',
                                            padding: '2px 6px', border: '1px solid var(--line)',
                                            color: t.untagged ? 'var(--ink-soft)' : 'var(--ink)',
                                            background: t.key === 'proj' && !t.untagged ? 'var(--paper-2)' : '#fff',
                                        }}>{t.label}: {t.value}</span>
                                    ))}
                                </div>

                                {/* WHY IT IS NOT ON THE STEP — the same sentence "why not the other N?"
                                    prints, because it is the same admits() call. */}
                                {blocked && (
                                    <div style={{ ...mono, fontSize: '9px', color: 'var(--rust, #a4442c)', marginTop: '6px', textTransform: 'none', letterSpacing: 0 }}>
                                        ⚠ not offered on this configuration — {verdict.rule}: {verdict.detail}
                                    </div>
                                )}
                                {verdict && verdict.ok && (
                                    <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '6px' }}>
                                        ✓ selectable on this configuration
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
