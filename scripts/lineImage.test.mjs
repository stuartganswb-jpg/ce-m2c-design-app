// A picture on an order line, pinned (S7, step 7, 2026-10-11): a sample line's picture is the one picked from
// the gallery, else the item's own PHOTOGRAPH — never a render or an inherited stand-in; the quote records
// them in cart order; the document strip prints the full picture with the line's code and memo.
import { itemPhotoOf, lineImageOfAsset, lineImageForItem, lineImagesOf, lineImageStripOf } from '../src/components/Shared/lineImage.js';
import { IMG_GALLERY, IMG_GLB_RENDER, IMG_BASE_INHERIT } from '../src/components/Shared/partImage.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const photo = { id: 'u1', itemName: 'Bell swatch', finalImageUrl: 'https://x/bell.png', imageSource: IMG_GALLERY };
const render = { id: 'u2', itemName: 'rendered', finalImageUrl: 'https://x/auto.png', imageSource: IMG_GLB_RENDER };
const inherited = { id: 'u3', itemName: 'inherited', finalImageUrl: 'https://x/base.png', imageSource: IMG_BASE_INHERIT };
const autoUrl = { id: 'u4', itemName: 'old render', finalImageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/dynamic_assets%2Fauto_thumbs%2Fa.png' };
const none = { id: 'u5', itemName: 'no picture' };

ok('an item\'s gallery photograph is its picture', itemPhotoOf(photo) === 'https://x/bell.png');
ok('a render, an inherited stand-in, an unstamped auto-thumb and no picture give nothing', itemPhotoOf(render) === null && itemPhotoOf(inherited) === null && itemPhotoOf(autoUrl) === null && itemPhotoOf(none) === null);
ok('a new line starts with the item\'s photograph, source ITEM', lineImageForItem(photo).url === 'https://x/bell.png' && lineImageForItem(photo).source === 'ITEM' && lineImageForItem(render) === null);
const asset = { id: 'ASSET-1', name: 'BELL 10 SWATCH', patternId: 'BELL', finishId: '10', thumbnailUrl: 'https://x/t.png', originalUrl: 'https://x/o.png' };
const li = lineImageOfAsset(asset);
ok('a gallery asset becomes the line\'s picture with its thumbnail and full image', li.url === 'https://x/t.png' && li.fullUrl === 'https://x/o.png' && li.assetId === 'ASSET-1' && li.patternId === 'BELL' && li.source === 'GALLERY');
ok('an asset with no usable url gives nothing', lineImageOfAsset({ id: 'x', url: 'data:image/png;base64,AA' }) === null);
const lines = [{ erp: 'BELL/10', name: 'Bell swatch', qty: 2, lineMemo: 'living room', lineImage: li }, { erp: 'NAKA10-THROW', name: 'Throw', qty: 1 }, { erp: 'X', aliasErp: 'CUST-1', name: 'x', qty: 1, lineImage: { url: 'https://x/c.png', source: 'ITEM' } }];
const recorded = lineImagesOf(lines);
ok('the quote records one row per pictured line, in cart order, the alias code first', recorded.length === 2 && recorded[0].code === 'BELL/10' && recorded[0].memo === 'living room' && recorded[0].qty === 2 && recorded[1].code === 'CUST-1' && recorded[1].fullUrl === 'https://x/c.png');
const strip = lineImageStripOf(recorded);
ok('the document strip prints the full picture with code and memo', strip.length === 2 && strip[0].src === 'https://x/o.png' && strip[0].caption === 'BELL/10 · living room' && strip[1].caption === 'CUST-1');
ok('a bad url never reaches the paper', lineImageStripOf([{ url: 'data:x' }, { url: 'https://x/a.png', code: 'A' }]).length === 1);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
