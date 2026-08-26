// KEYSTROKES ARE LOCAL; SAVES ARE NOT (Stuart 2026-08-26: "severe latency … it only captures
// every other letter" on tab 11's item fields and Stock View's order boxes).
//
// Both had the same disease in different forms: tab 11 wrote the WHOLE list to Firestore on every
// keystroke and re-rendered off the live snapshot's round-trip, so typing raced the network;
// Stock View re-rendered a several-thousand-row grid per letter. This input keeps what you type
// in its own state — every keystroke lands instantly — and COMMITS after a pause (default 350ms),
// on blur, or on Enter. External updates are accepted only while the field is not focused, so a
// snapshot arriving mid-word can never clobber your typing.
//
// Drop-in: replace `<input value={x} onChange={e => save(e.target.value)} />` with
// `<BufferedInput value={x} onCommit={save} />`. Everything else (style, placeholder, inputMode,
// title, list…) passes straight through.
import React, { useState, useRef, useEffect } from 'react';

const BufferedInput = ({ value, onCommit, delay = 350, ...rest }) => {
    const [v, setV] = useState(value ?? '');
    const focused = useRef(false);
    const timer = useRef(null);
    const last = useRef(value ?? '');

    useEffect(() => {
        if (!focused.current) { setV(value ?? ''); last.current = value ?? ''; }
    }, [value]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const fire = (val) => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        if (val !== last.current) { last.current = val; onCommit(val); }
    };

    return (
        <input
            {...rest}
            value={v}
            onFocus={(e) => { focused.current = true; if (rest.onFocus) rest.onFocus(e); }}
            onChange={(e) => {
                const val = e.target.value;
                setV(val);
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => fire(val), delay);
            }}
            onBlur={(e) => { focused.current = false; fire(e.target.value); if (rest.onBlur) rest.onBlur(e); }}
            onKeyDown={(e) => { if (e.key === 'Enter') fire(e.currentTarget.value); if (rest.onKeyDown) rest.onKeyDown(e); }}
        />
    );
};

export default BufferedInput;
