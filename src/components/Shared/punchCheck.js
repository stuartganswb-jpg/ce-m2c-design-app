// ── A PUNCH THAT DOES NOT MATCH THE WORK (Stuart 2026-10-01) ────────────────────────────────────
// WO-SO60712: after the order was questioned, every remaining step — sled setup, spray, bake, the pole's
// hand coat, pole spray, pole bake — was logged complete between 2:11 and 2:13 PM. "This is clearly the
// operators forgetting to punch; when this happens and the sequence is too far away from reality pop up a
// warning to watch their punches and that this is being logged."
//
// The floor's own timers (Finishing settings) say how long each step normally takes. A completion is OFF
// when the step was never started, or ran less than a QUARTER of its normal time (never under one minute).
// A CATCH-UP RUN is three or more steps completed on one order by one person inside five minutes — the
// 2:11–2:13 pattern, whatever each step's own time.
//
// Nothing here blocks: the step still completes, so nobody is stuck. It says so on the screen, in English and
// in Spanish, writes the floor log, and stamps the step so the order window shows it. Pure — no React, no
// Firestore. Harness: scripts/punchCheck.test.mjs.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MIN = 60000;

export const PUNCH_FLAG = { NO_START: 'NO_START', TOO_SHORT: 'TOO_SHORT' };
export const PUNCH_SHARE = 0.25;        // under a quarter of normal
export const PUNCH_FLOOR_MINS = 1;      // …and never less than a minute
export const CATCH_UP_STEPS = 3;
export const CATCH_UP_WINDOW_MS = 5 * MIN;

/** The steps, as the Spanish half of the warning names them. */
export const TASK_LABEL_ES = {
    spinSetup: 'Preparación', spinSpray: 'Pintura', spinBake: 'Horno',
    poleSpray: 'Pintura de barras', poleBake: 'Horno de barras',
    hand: 'Acabado a mano', poleHand: 'Acabado a mano (barras)',
};

/** The poles on a finishing document, the way the floor's cards count them. */
const polesOf = (wo) => num(wo && (wo.totalPoles || (wo.poles && wo.poles.qty))) || 1;

/**
 * How long this step normally takes, in minutes — the same figures the floor's cards print as "Est Time".
 * @param cfg  { spinSetupMins, spinPaintMins, ovenMins, poleMins, handPoleMins, handSmallMins }
 */
export function normalMinutesOf(taskKey, wo, cfg = {}) {
    switch (String(taskKey || '')) {
        case 'spinSetup': return num(cfg.spinSetupMins);
        case 'spinSpray': return num(cfg.spinPaintMins);
        case 'spinBake':
        case 'poleBake': return num(cfg.ovenMins);
        case 'poleSpray': return polesOf(wo) * num(cfg.poleMins);
        case 'poleHand': return polesOf(wo) * num(cfg.handPoleMins);
        case 'hand': return (wo && wo.type === 'Poles')
            ? num(wo.totalParts) * num(cfg.handPoleMins)
            : num(wo && wo.totalParts) * num(cfg.handSmallMins);
        default: return 0;
    }
}

/** The shortest this step can honestly be: a quarter of normal, never under a minute. */
export const minHonestMinutes = (normalMins) => Math.max(PUNCH_FLOOR_MINS, num(normalMins) * PUNCH_SHARE);

/**
 * One completion, judged.
 * @returns { flag: 'NO_START' | 'TOO_SHORT' | null, ranMins: number | null, normalMins, minMins }
 */
export function punchCheckOf({ startedMs, completedMs, normalMins } = {}) {
    const normal = num(normalMins);
    const minMins = minHonestMinutes(normal);
    if (!startedMs) return { flag: PUNCH_FLAG.NO_START, ranMins: null, normalMins: normal, minMins };
    const ranMins = Math.max(0, (num(completedMs) - num(startedMs)) / MIN);
    return { flag: ranMins < minMins ? PUNCH_FLAG.TOO_SHORT : null, ranMins, normalMins: normal, minMins };
}

/**
 * Is this completion the third (or more) on this order, by this person, inside five minutes?
 * `wo.tasks` is read as it stands BEFORE the completion being made; `taskKey` is the one being completed now.
 * @returns { count, keys } | null
 */
export function catchUpRunOf({ wo, actor, taskKey, nowMs } = {}) {
    const who = String(actor || '').trim();
    if (!who || !nowMs) return null;
    const keys = [String(taskKey || '')];
    Object.entries((wo && wo.tasks) || {}).forEach(([k, t]) => {
        if (k === taskKey || !t) return;
        const at = num(t.completedAt);
        if (at && String(t.completedBy || '').trim() === who && nowMs - at >= 0 && nowMs - at <= CATCH_UP_WINDOW_MS) keys.push(k);
    });
    return keys.length >= CATCH_UP_STEPS ? { count: keys.length, keys } : null;
}

const mins = (m) => (m == null ? '' : (m < 1 ? 'under 1 min' : `${Math.round(m)} min`));
const minsEs = (m) => (m == null ? '' : (m < 1 ? 'menos de 1 min' : `${Math.round(m)} min`));

/** What the operator reads, in English and in Spanish. `stepEs` is the step's Spanish name where there is one. */
export function punchWarning({ who = '', order = '', step = '', stepEs = '', check = null, catchUp = null } = {}) {
    const c = check || {};
    const normal = c.normalMins > 0 ? `about ${Math.round(c.normalMins)} min` : '';
    const normalEs = c.normalMins > 0 ? `unos ${Math.round(c.normalMins)} min` : '';
    const en = [`⏱ CHECK YOUR PUNCHES${who ? ` — ${who}` : ''}`, `${step}${order ? ` · ${order}` : ''}`, ''];
    const es = [`⏱ REVISE SUS REGISTROS${who ? ` — ${who}` : ''}`, `${stepEs || step}${order ? ` · ${order}` : ''}`, ''];
    if (c.flag === PUNCH_FLAG.NO_START) {
        en.push(`This step was completed without ever being started${normal ? ` (it normally takes ${normal})` : ''}.`);
        es.push(`Este paso se completó sin haberse iniciado${normalEs ? ` (normalmente toma ${normalEs})` : ''}.`);
    } else if (c.flag === PUNCH_FLAG.TOO_SHORT) {
        en.push(`This step was logged as ${mins(c.ranMins)}${normal ? ` — it normally takes ${normal}` : ''}.`);
        es.push(`Este paso se registró con ${minsEs(c.ranMins)}${normalEs ? ` — normalmente toma ${normalEs}` : ''}.`);
    }
    if (catchUp) {
        en.push(`${catchUp.count} steps on this order were completed within 5 minutes.`);
        es.push(`Se completaron ${catchUp.count} pasos de este pedido en menos de 5 minutos.`);
    }
    en.push('', 'Press START when the work starts and COMPLETE when it is done.', 'This punch has been logged.');
    es.push('', 'Presione EMPIEZA cuando comience el trabajo y COMPLETADO cuando termine.', 'Este registro ha sido anotado.');
    return [...en, '', '────────────', '', ...es].join('\n');
}

/** One line for the order window's tile: "⚠ ran under 1 min (normal ~10)" / "⚠ no start punch". */
export function punchFlagText(task) {
    const t = task || {};
    if (t.punchFlag === PUNCH_FLAG.NO_START) return `⚠ no start punch${num(t.punchNormalMins) > 0 ? ` (normal ~${Math.round(num(t.punchNormalMins))} min)` : ''}`;
    if (t.punchFlag === PUNCH_FLAG.TOO_SHORT) {
        const ran = t.punchRanMs != null ? num(t.punchRanMs) / MIN : null;
        return `⚠ ran ${mins(ran)}${num(t.punchNormalMins) > 0 ? ` (normal ~${Math.round(num(t.punchNormalMins))} min)` : ''}`;
    }
    return '';
}
