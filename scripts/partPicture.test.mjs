// node scripts/partPicture.test.mjs — which picture a part SHOWS: its own → its mill item's → its kit's.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { partImageOf, kitHolding, buildSpeciesBaseIndex } = await import('../src/components/Shared/partPicture.js');
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
// OAK / WALNUT ITEMS SHOW THEIR PRODUCT (Stuart 2026-09-20)
{
    const inv = [
        { id: 'w1', legacyErpId: 'H1-138WEC', finalImageUrl: 'wec.png' },
        { id: 'w2', legacyErpId: 'H1-138WEC-O' }, { id: 'w3', legacyErpId: 'H1-138WEC-W' }, { id: 'w4', legacyErpId: 'H1-138WEC-O/S03' },
        { id: 'r1', legacyErpId: 'H1-138WR', finalImageUrl: 'rod.png', manufacturingSpecs: { customData: { speciesMap: { '-O': 'H1-138WHTOAK', '-W': 'H1-138WLNUT' } } } },
        { id: 'r2', legacyErpId: 'H1-138WHTOAK' },
        { id: 'x1', legacyErpId: 'HTS-W' },                              // ends in -W but no base "HTS" exists
    ];
    const by = new Map(inv.map(p => [p.legacyErpId, p])); const find = (c) => by.get(c) || null;
    const sp = buildSpeciesBaseIndex(inv);
    eq('-O / -W by suffix, stem-different by the base\'s speciesMap; never a code with no base', [sp.get('H1-138WEC-O'), sp.get('H1-138WEC-W'), sp.get('H1-138WHTOAK'), sp.get('HTS-W') || null], ['H1-138WEC', 'H1-138WEC', 'H1-138WR', null]);
    eq('the oak end cap shows the end cap', partImageOf(by.get('H1-138WEC-O'), find, [], sp), { url: 'wec.png', from: 'H1-138WEC' });
    eq('…and so does its stained variant', partImageOf(by.get('H1-138WEC-O/S03'), find, [], sp), { url: 'wec.png', from: 'H1-138WEC' });
    eq('white oak rod shows the wood rod', partImageOf(by.get('H1-138WHTOAK'), find, [], sp).from, 'H1-138WR');
}
console.log(`partPicture: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
