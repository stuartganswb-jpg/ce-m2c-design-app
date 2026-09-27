// node --import ./scripts/loops/register.mjs scripts/loops/smoke.loop.mjs — can the route modules load?
const m = await import('../../src/components/Shared/oeGenerate.js');
const fs = await import('./fake-firestore.mjs');
console.log('oeGenerate exports:', Object.keys(m).join(', '));
console.log('fake fs ok:', typeof fs.__fs.seed);
