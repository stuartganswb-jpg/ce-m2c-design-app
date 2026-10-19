// FEWER CENTRE BRACKETS THAN 6.5 RECOMMENDS — WHAT IT RISKS, SAID AND DRAWN (Stuart 2026-10-19: "could a pop up window open that
// states risk of deflection is possible if the span is too long and studs are used and risk of drywall anchor failure if the
// selection is drywall anchor and not enough brackets for the span. A simple black and white illustration of the pole bending down
// in the center or a backplate pulling out of the wall. then a confirm button?" · "both" — CPQ and the portal).
//
// One file for both screens: each draws its own window around these words and drawings, so CPQ and the portal always say and show
// the same thing. The numbers come from the engine (hardwareSession.supportShortfallOf / bracketAdviceOf); nothing here decides.
import React from 'react';

/** The words of the window, for one short count: a stud risks the pole bowing, drywall with toggles risks a bracket pulling out. */
export function spanRiskOf({ onStud, chosen, recommended, lengthInches, everyInches }) {
    const n = Math.max(0, Number(chosen) || 0);
    const r = Math.max(0, Number(recommended) || 0);
    const what = n ? `${n} centre bracket${n === 1 ? '' : 's'}` : 'No centre bracket';
    const where = `where ${r} ${r === 1 ? 'is' : 'are'} recommended for ${lengthInches ? `this ${lengthInches}″ pole` : 'this pole'}`;
    return onStud ? {
        kind: 'DEFLECTION',
        title: 'Risk of deflection',
        lead: `${what} ${where} in a stud.`,
        body: `With the brackets more than ${everyInches ? `${everyInches}″` : 'the recommended span'} apart, the pole can bow in the middle under the weight of the curtain.`,
    } : {
        kind: 'ANCHOR',
        title: 'Risk of anchor failure',
        lead: `${what} ${where} on drywall with toggles.`,
        body: 'Each bracket then carries more than drywall toggles hold reliably, and a backplate can pull out of the wall.',
    };
}

export const SPAN_RISK_ASK = 'Confirm to go ahead with this count, or go back and add brackets.';

// ── THE TWO DRAWINGS — line art in the text colour on a plain ground, so they print and read in black and white ──
const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };

/** A pole between two brackets, bowing in the middle — the straight line it should keep is dashed. */
export function DeflectionArt({ width = 320 }) {
    const drops = [70, 115, 160, 205, 250];
    const sagAt = (x) => { const t = (x - 30) / 260; return 55 + 4 * 30 * t * (1 - t); };   // the bow, 30 deep at the centre
    return (
        <svg viewBox="0 0 320 130" width={width} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} role="img" aria-label="A curtain pole bowing down in the middle between two brackets">
            <line x1="10" y1="14" x2="310" y2="14" {...line} strokeWidth="2" />
            {[40, 280].map(x => <path key={x} d={`M${x} 14 V44 M${x - 9} 44 Q${x} 62 ${x + 9} 44`} {...line} strokeWidth="3" />)}
            <line x1="26" y1="55" x2="294" y2="55" {...line} strokeWidth="1.5" strokeDasharray="5 5" />
            <path d="M26 55 Q160 115 294 55" {...line} strokeWidth="7" />
            {drops.map(x => <line key={x} x1={x} y1={sagAt(x) + 5} x2={x} y2={sagAt(x) + 28} {...line} strokeWidth="1.5" />)}
            <path d="M185 62 V92 M178 84 L185 93 L192 84" {...line} strokeWidth="2.5" />
        </svg>
    );
}

/** A wall in section, a backplate pulling away from it, its toggles coming out of the drywall under the pole's weight. */
export function AnchorArt({ width = 320 }) {
    const hatch = [];
    for (let y = 6; y < 130; y += 10) hatch.push(<line key={y} x1="40" y1={y + 8} x2="62" y2={y - 6} {...line} strokeWidth="1" />);
    return (
        <svg viewBox="0 0 320 130" width={width} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} role="img" aria-label="A bracket backplate pulling out of a drywall wall">
            <defs><clipPath id="spanRiskWall"><rect x="40" y="4" width="22" height="122" /></clipPath></defs>
            <rect x="40" y="4" width="22" height="122" {...line} strokeWidth="2" />
            <g clipPath="url(#spanRiskWall)">{hatch}</g>
            {/* the plate, its two toggles, the arm and the pole — tipped out from the wall about the plate's foot */}
            <g transform="rotate(10 66 96)">
                <path d="M66 44 H48 M52 40 L48 44 L52 48" {...line} strokeWidth="2" />
                <path d="M66 84 H50" {...line} strokeWidth="2" />
                <rect x="66" y="34" width="9" height="62" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
                <path d="M75 50 H204" {...line} strokeWidth="5" />
                <circle cx="214" cy="50" r="10" fill="#fff" stroke="currentColor" strokeWidth="3" />
            </g>
            <path d="M218 92 V120 M211 112 L218 121 L225 112" {...line} strokeWidth="2.5" />
            <path d="M86 28 L110 19 M102 18 L110 19 L106 26" {...line} strokeWidth="2.5" />
        </svg>
    );
}

/** The drawing for a risk's kind. */
export const SpanRiskArt = ({ kind, width }) => (kind === 'DEFLECTION' ? <DeflectionArt width={width} /> : <AnchorArt width={width} />);
