// The counter's camera, pinned (S7, 2026-10-15): the first shot lands on the throw(s) and the fabric, on a pillow
// only when there is neither; every item of the colourway is attached; the patch names the gallery as the source.
import { photoTargetsOf, itemPicturePatchOf } from '../src/components/Shared/counterPhoto.js';
import { colourwaysOf } from '../src/components/Shared/pillowCatalog.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [
    item('Bell/10P19x19'), item('Bell/10P23x23'), item('Bell/10T'), item('Bell/10T-XL'), item('Bell/10F', { specs: { productType: 'FABRIC' } }), item('SWA/Bell10'),
    item('Tie/01P36x20'), item('Tie/01P19x19'),
];
const cat = colourwaysOf(lib);
const t = photoTargetsOf(cat.byKey.get('BELL/10'));
ok('Bell/10: the throw, the XL and the fabric are stamped; every item of the colourway is attached', t.items.map(i => i.legacyErpId).join() === 'Bell/10T,Bell/10T-XL,Bell/10F' && t.codes.join() === 'Bell/10T,Bell/10T-XL,Bell/10F,Bell/10P19x19,Bell/10P23x23,SWA/Bell10');
const t2 = photoTargetsOf(cat.byKey.get('TIE/01'));
ok('Tie/01 (pillows only): the first pillow is stamped; both pillows attached', t2.items.length === 1 && t2.items[0].legacyErpId === 'Tie/01P36x20' && t2.codes.length === 2);
ok('nothing → nothing', photoTargetsOf(null).items.length === 0 && photoTargetsOf({}).codes.length === 0);
const p = itemPicturePatchOf({ originalUrl: 'https://x/hi.png', thumbnailUrl: 'https://x/th.png', by: 'laetitia', at: 7 });
ok('the patch: hi-res as the image, the thumb beside it, GALLERY as the source, who and when', p.finalImageUrl === 'https://x/hi.png' && p.componentImageUrl === 'https://x/th.png' && p.imageSource === 'GALLERY' && p.pictureTakenBy === 'laetitia' && p.pictureTakenAt === 7 && p.updatedAt === 7);
ok('no thumb → the hi-res serves both', itemPicturePatchOf({ originalUrl: 'https://x/hi.png' }).componentImageUrl === 'https://x/hi.png');
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
