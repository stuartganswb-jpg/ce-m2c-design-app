// node scripts/partPicture.test.mjs — which picture a part SHOWS: its own → its mill item's → its kit's.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { partImageOf, kitHolding } = await import('../src/components/Shared/partPicture.js');
const { isAutoImage, IMG_KIT_INHERIT, imageUpdate } = await import('../src/components/Shared/partImage.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const lib = {
    'H1-138BS': { id: 'a', legacyErpId: 'H1-138BS', finalImageUrl: 'bs.png' },
    'H1-138BS/P25': { id: 'b', legacyErpId: 'H1-138BS/P25' },
    'H1-2RCTJC': { id: 'c', legacyErpId: 'H1-2RCTJC' },
    'H1-2RCTJC/EP4': { id: 'd', legacyErpId: 'H1-2RCTJC/EP4' },
    'LONELY': { id: 'e', legacyErpId: 'LONELY' },
};
const kit = { id: 'k', legacyErpId: 'H1-2RCTCB', finalImageUrl: 'kit.png', manufacturingSpecs: { kitComponents: [{ partId: 'c' }, { partId: 'H1-2RCTSOB' }] } };
const f = (c) => lib[c] || null;
eq('its own picture wins', partImageOf(lib['H1-138BS'], f, [kit]), { url: 'bs.png', from: '' });
eq('a finish variant shows its mill item', partImageOf(lib['H1-138BS/P25'], f, [kit]), { url: 'bs.png', from: 'H1-138BS' });
eq('a piece of a kit shows the kit — the pieces together', partImageOf(lib['H1-2RCTJC'], f, [kit]), { url: 'kit.png', from: 'H1-2RCTCB' });
eq('…and so does that piece in a finish', partImageOf(lib['H1-2RCTJC/EP4'], f, [kit]), { url: 'kit.png', from: 'H1-2RCTCB' });
eq('a component named by code is found too', !!kitHolding({ legacyErpId: 'H1-2RCTSOB' }, [kit]), true);
eq('nothing anywhere → nothing, never a wrong picture', partImageOf(lib['LONELY'], f, [kit]), { url: '', from: '' });
eq('a kit-inherited picture is a stand-in a photograph may overwrite', isAutoImage(imageUpdate('kit.png', IMG_KIT_INHERIT)), true);
console.log(`partPicture: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
