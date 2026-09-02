// One source for the shop app's shared plumbing (2026-08-26). shopDb/cleanId were copy-pasted
// across ShopFloor.js + ShopEngineering.js, and the tab list was hand-synced with AdminTab's
// SHOP_TABS — which had drifted ('app imp' existed only on the floor side, so the permissions
// editor could never grant it).
import { db } from '../../firebase';
import { collection } from 'firebase/firestore';

export const shopDb = { collection: (colName) => collection(db, colName.startsWith('shop_') ? colName : `shop_${colName}`) };

export const cleanId = (s1, s2) => `${s1}_${s2}`.replace(/[^a-zA-Z0-9]/g, "_");

// The hq_work_orders record behind a shop spine doc, by the WRITER's own convention: RTG's
// pushToShop names the shop doc `SHOP-<hq work order id>` and RTG's component gate reads
// `SHOP-<cid>` straight back. Read, never inferred — the spine's orderKey is NOT that id (the
// stock writers set it to the library part's id), which is why a key walk finds no parent here.
export const hqWorkOrderIdOf = (spine) => {
    const id = String(spine?.id || '');
    return id.startsWith('SHOP-') && id.length > 5 ? id.slice(5) : null;
};

// The full tab list, in nav order. AdminTab's per-role permissions editor renders this same list.
// ('admin' displays as MACHINE CONFIG on the floor.)
export const SHOP_TABS = ['floor', 'milling', 'scheduler', 'custom', 'logs', 'export', 'routings', 'programs', 'tooling', 'messaging', 'reports', 'livio', 'assets', 'app imp', 'admin'];
