// 🧪 How a product is packaged — the picture and the note on the item, and a finish variant showing its base's (Stuart 2026-10-08).
//    node scripts/productPackaging.test.mjs
import { packagingOf, ownPackagingOf, packagingImagesIn, withPackagingImage, withoutPackagingImage, packagingImageRefusal, PACKAGING_IMAGES_MAX } from '../src/components/Shared/productPackaging.js';
import { buildSpeciesBaseIndex } from '../src/components/Shared/partPicture.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

const item = (code, customData = {}) => ({ id: `CE-INV-${code}`, legacyErpId: code, manufacturingSpecs: { customData } });
const ring = item('H1-138RG', { packagingImages: ['u/ring-bag.jpg', 'u/ring-box.jpg'], packagingNote: 'Bag of 7, bag into the small white box' });
const ringP = item('H1-138RG/P');                                              // a paint variant with nothing of its own
const ringEp = item('H1-138RG/EP1', { packagingNote: 'Tissue between each — plated' });   // its own note, no picture
const ringOwn = item('H1-138RG/P25', { packagingImages: ['u/ring-p25.jpg'] });  // its own picture, no note
const bare = item('H1-138BK');                                                 // nothing anywhere
const wec = item('H1-138WEC', { packagingImages: ['u/wec.jpg'], packagingNote: 'Foam sleeve' });
const wecOak = item('H1-138WEC-O');
const wecOakStain = item('H1-138WEC-O/S04');
const lib = [ring, ringP, ringEp, ringOwn, bare, wec, wecOak, wecOakStain];
const find = (c) => lib.find(p => p.legacyErpId === String(c).toUpperCase()) || null;
const species = buildSpeciesBaseIndex(lib);

// ── the item's own ──
eq('an item carries its own pictures and note', ownPackagingOf(ring), { images: ['u/ring-bag.jpg', 'u/ring-box.jpg'], note: 'Bag of 7, bag into the small white box' });
eq('…and reads them back as its own', packagingOf(ring, find), { images: ['u/ring-bag.jpg', 'u/ring-box.jpg'], imagesFrom: '', note: 'Bag of 7, bag into the small white box', noteFrom: '', any: true });
eq('nothing on an item with nothing', ownPackagingOf(bare), { images: [], note: '' });
eq('…and nothing to show for it', packagingOf(bare, find), { images: [], imagesFrom: '', note: '', noteFrom: '', any: false });
eq('no item, nothing', packagingOf(null, find), { images: [], note: '', imagesFrom: '', noteFrom: '', any: false });

// ── one product, every finish ──
eq('a finish variant with nothing of its own shows its base item\'s', packagingOf(ringP, find), { images: ['u/ring-bag.jpg', 'u/ring-box.jpg'], imagesFrom: 'H1-138RG', note: 'Bag of 7, bag into the small white box', noteFrom: 'H1-138RG', any: true });
eq('a variant\'s own note sits over its base\'s picture', packagingOf(ringEp, find), { images: ['u/ring-bag.jpg', 'u/ring-box.jpg'], imagesFrom: 'H1-138RG', note: 'Tissue between each — plated', noteFrom: '', any: true });
eq('a variant\'s own picture sits over its base\'s note', packagingOf(ringOwn, find), { images: ['u/ring-p25.jpg'], imagesFrom: '', note: 'Bag of 7, bag into the small white box', noteFrom: 'H1-138RG', any: true });
eq('a variant whose base is not in the library shows nothing', packagingOf(item('H9-X/P'), find).any, false);
eq('with no lookup handed in, only the item itself is read', packagingOf(ringP).any, false);
eq('a species item shows the product it is a species of', packagingOf(wecOak, find, species), { images: ['u/wec.jpg'], imagesFrom: 'H1-138WEC', note: 'Foam sleeve', noteFrom: 'H1-138WEC', any: true });
eq('…and so does a stain of that species', packagingOf(wecOakStain, find, species).imagesFrom, 'H1-138WEC');
eq('without the species index a species item reads only itself', packagingOf(wecOak, find).any, false);
eq('an item still on PENDING is read by its own id', packagingOf({ itemId: 'H1-138RG/P', legacyErpId: 'PENDING' }, find).imagesFrom, 'H1-138RG');

// ── how the field may be stored ──
eq('one url stored bare reads as a list of one', packagingImagesIn({ packagingImages: 'u/a.jpg' }), ['u/a.jpg']);
eq('blanks are dropped', packagingImagesIn({ packagingImages: ['', ' u/a.jpg ', null] }), ['u/a.jpg']);
eq('an emptied list is no pictures — the base answers again', packagingOf(item('H1-138RG/BS', { packagingImages: [], packagingNote: '  ' }), find).imagesFrom, 'H1-138RG');

// ── the drawer's edits ──
eq('a picture is added at the end', withPackagingImage(['a'], 'b'), ['a', 'b']);
eq('the same picture is not added twice', withPackagingImage(['a'], 'a'), ['a']);
eq('a blank is not added', withPackagingImage(['a'], '  '), ['a']);
eq('a picture is removed', withoutPackagingImage(['a', 'b'], 'a'), ['b']);
const full = Array.from({ length: PACKAGING_IMAGES_MAX }, (_, i) => `u/${i}`);
eq('never more than the cap', withPackagingImage(full, 'u/more').length, PACKAGING_IMAGES_MAX);
ok('…and the drawer is told why', /at most/.test(packagingImageRefusal(full)));
eq('room left, no refusal', packagingImageRefusal(['a']), '');
eq('the list handed in is not changed', (() => { const l = ['a']; withPackagingImage(l, 'b'); return l; })(), ['a']);

console.log(`productPackaging: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
