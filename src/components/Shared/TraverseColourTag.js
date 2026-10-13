// The traverse colour that goes with a finish, drawn the same on the recipe card (Finishing → FINISH RECIPES) and on
// the order's recipe window on the Active floor (Stuart 2026-10-13 · Shared/traverseColour). Read from 4.5; never set here.
import React from 'react';
import { traverseColourOf } from './traverseColour';

const MONO = 'var(--mono, ui-monospace, Menlo, monospace)';
const TONE = { TBR: { bg: '#f1e7dc', line: '#8a5a2b', ink: '#5c3a17' }, TCP: { bg: '#f7f0dc', line: '#b99a4a', ink: '#6b561c' } };

const TraverseColourTag = ({ recipeCode, finishes = [], style = {} }) => {
    const tag = traverseColourOf(recipeCode, finishes);
    if (!tag) return null;
    const t = TONE[tag.code] || { bg: 'var(--paper, #faf9f6)', line: 'var(--line, #e2ddd2)', ink: 'var(--ink, #1a1a1a)' };
    return (
        <div title="The colour the traverse track, F-clips and stock-colour traverse parts are finished in for this finish. Set in HQ 4.5 Mass Update — the floor only reads it."
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', padding: '5px 10px', background: t.bg, border: `1px solid ${t.line}`, color: t.ink, fontFamily: MONO, fontSize: '10px', letterSpacing: '.06em', lineHeight: 1.5, ...style }}>
            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>{tag.kind === 'IS' ? 'Traverse colour' : 'Traverse parts'}</span>
            <span style={{ fontWeight: 700 }}>{tag.code}{tag.name ? ` · ${tag.name}` : ''}</span>
            {tag.kind === 'IS' && <span style={{ letterSpacing: 0 }}>goes with {tag.goesWith.length ? tag.goesWith.join(', ') : 'no finish yet'}</span>}
        </div>
    );
};

export default TraverseColourTag;
