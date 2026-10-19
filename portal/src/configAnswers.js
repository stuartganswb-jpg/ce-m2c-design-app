// THE CUSTOMER'S ANSWERS, as the Configure screen keeps them (the portal rebuild, step 4 — 2026-10-14). The same answers
// CPQ's screen keeps for a configuration — answers, picks, sizes, the length as typed, counts, fabric, finishes — plus the
// removals the customer has said Understood to. Pure: the screen, the request being built, and scripts/portalConfigure.test.mjs.

export const FRACTIONS = ['', '1/16', '1/8', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '9/16', '5/8', '11/16', '3/4', '13/16', '7/8', '15/16'];

// The curtain length is kept as typed ('' = the 8 ft the span assumes) and the stud answer as yes / no — with the fabric weight,
// what the span is worked from (2026-10-19).
export const blankAnswers = () => ({ answers: {}, picks: {}, sizePick: {}, poleIn: '', poleFrac: '', stepQty: {}, fabricId: 'PRINT', dropFt: '', onStud: true, globalFinishes: {}, partFinish: {}, finishAnswers: {}, memo: '', qty: '1', acks: [] });

// What the server is sent: the answers, and the removals said Understood to. The server works the length out of the typed
// inches and fraction itself (hardwareSession.lengthInchesOf) and refuses anything the portal does not offer.
export const wireOf = (a) => ({ answers: a.answers, picks: a.picks, sizePick: a.sizePick, poleIn: a.poleIn, poleFrac: a.poleFrac, stepQty: a.stepQty, fabricId: a.fabricId,
  dropFt: a.dropFt || '', onStud: a.onStud !== false,
  globalFinishes: a.globalFinishes, partFinish: a.partFinish, finishAnswers: a.finishAnswers, memo: a.memo, qty: Math.max(1, parseInt(a.qty, 10) || 1),
  drops: (a.acks || []).map((key) => ({ key, acked: true })) });

// …and back, when a line of the request is opened again to change it.
export const answersOf = (wire) => {
  const { drops = [], ...rest } = wire || {};
  return { ...blankAnswers(), ...rest, qty: String(rest.qty || 1), acks: (Array.isArray(drops) ? drops : []).filter((d) => d && d.acked).map((d) => d.key) };
};

// CPQ's click (HardwareConfigurator setAnswer / setPick): a second click on the same choice takes it off.
export const toggled = (map, key, value) => { const next = { ...map }; if (next[key] === value) delete next[key]; else next[key] = value; return next; };
