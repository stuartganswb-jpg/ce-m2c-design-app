// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT A FINISH ASKS OF THE ORDER — the brass surface and coating (Stuart 2026-10-06)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "the line can be the plain brass item, the LBR is the finish then in a memo we can add notes that travel
//  whether it is polished or brushed or lacquered/unlacquered" · "a dedicated field would be better" ·
//  one answer for the "whole config" · "yes required".
//
// Solid brass is ONE finish (LBR) and ONE item per part, but the order is not complete until it says how the
// brass is finished: brushed or polished, lacquered or not. A typed memo can be forgotten or misspelled, so the
// FINISH carries the questions (4.5 → the finish's form), CPQ asks them once per configuration wherever that
// finish is worn, Add waits for the answers, and they are written into the finish text of every line that wears
// it — the one string the quote, the sales order, the floor sheets, the pick and the packing list already print.
//
//      finish.questions = [{ label: 'Surface', choices: ['Brushed', 'Polished'] },
//                          { label: 'Coating', choices: ['Unlacquered', 'Lacquered'] }]
//      answers          = { Surface: 'Polished', Coating: 'Lacquered' }        (per finish code, per configuration)
//      on the line      finishLabel 'LIVE SOLID BRASS · Polished · Lacquered', finishDetail 'Polished · Lacquered'
//
// Any finish may ask; a finish with no questions is exactly as it was. Pure. Harness: scripts/finishQuestions.test.mjs.

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const same = (a, b) => clean(a).toUpperCase() === clean(b).toUpperCase();

/** A finish's questions, cleaned: a label and at least two different choices each; duplicates dropped. */
export function questionsOf(finish) {
    const raw = finish && Array.isArray(finish.questions) ? finish.questions : [];
    const out = [];
    raw.forEach(q => {
        const label = clean(q && q.label);
        if (!label || out.some(x => same(x.label, label))) return;
        const choices = [];
        (Array.isArray(q.choices) ? q.choices : []).forEach(c => { const v = clean(c); if (v && !choices.some(x => same(x, v))) choices.push(v); });
        if (choices.length >= 2) out.push({ label, choices });
    });
    return out;
}

/**
 * The editor's text → questions. One per line: "Surface: Brushed, Polished".
 * A line with no colon, no label or fewer than two choices is not a question and is dropped.
 */
export function parseQuestions(text) {
    const rows = String(text == null ? '' : text).split(/\r?\n/).map(line => {
        const at = line.indexOf(':');
        if (at < 1) return null;
        return { label: line.slice(0, at), choices: line.slice(at + 1).split(/[,;|/]/) };
    }).filter(Boolean);
    return questionsOf({ questions: rows });
}

/** Questions → the editor's text. */
export const questionsText = (questions) => questionsOf({ questions }).map(q => `${q.label}: ${q.choices.join(', ')}`).join('\n');

/** The answer given to one question, as the finish spells it — '' when unanswered or not one of its choices. */
const answerTo = (q, answers) => {
    const key = Object.keys(answers || {}).find(k => same(k, q.label));
    const given = key ? answers[key] : '';
    return q.choices.find(c => same(c, given)) || '';
};

/** The labels still unanswered — every question is required. */
export const unansweredOf = (finish, answers) => questionsOf(finish).filter(q => !answerTo(q, answers)).map(q => q.label);

/** The answers in the finish's own order, as { label: choice } — only what was validly answered. */
export function answersOf(finish, answers) {
    const out = {};
    questionsOf(finish).forEach(q => { const a = answerTo(q, answers); if (a) out[q.label] = a; });
    return out;
}

/** The answers in words: "Polished · Lacquered" ('' when the finish asks nothing or nothing is answered). */
export const answersText = (finish, answers) => Object.values(answersOf(finish, answers)).join(' · ');

/** A finish's name with its answers: "LIVE SOLID BRASS · Polished · Lacquered". */
export const finishTextWith = (name, detail) => (clean(detail) ? `${clean(name)} · ${clean(detail)}` : clean(name));
