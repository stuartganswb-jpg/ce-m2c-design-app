// THE Pick & Pack tab list — ONE definition, imported by both the app that renders the tabs
// (PickPack/PickPackApp) and the role matrix that grants them (HQ/AdminTab).
//
// It lived in both files before, and they drifted: AdminTab's copy never gained 'ROD CUTS', so the
// matrix had no row for it, nobody could be granted it, and a Setup Manager with "every box ticked"
// still couldn't see the tab (Stuart 2026-07-28: "why can Sandra G not see this tab?"). A permission
// you cannot grant is worse than one that is denied — it looks granted.
//
// KEYS ARE PERMISSION IDENTITY. pick_config/permissions stores each role's allowed tabs BY KEY, so
// renaming one silently revokes that tab for every role. Rename the LABEL below instead.
export const PICK_TABS = ['QUEUE', 'STOCK', 'PACKING', 'COUNT', 'CONVERT', 'RECEIVING', 'ROD CUTS', 'TRANSFER', 'PLATING', 'CHIPS', 'GALLERY', 'MESSAGING', 'APP IMP'];

// Display name for a tab key — used by the WMS nav and by the permission matrix, so an admin
// ticking a row sees exactly the words the operator sees on the floor.
export const pickTabLabel = (tab) => String(tab || '')
    .replace('QUEUE', 'PICK QUEUE')
    // 'STOCK' is a misnomer and always was — every order on that tab is a CUSTOMER order
    // (Stuart 2026-09-03: "this tab should be called special order packing as all the orders i
    // see on it are for customers"). The KEY stays 'STOCK' because keys are permission identity;
    // renaming it would silently revoke the tab for every role that has it ticked.
    .replace('STOCK', 'SO PACK')
    .replace('PACKING', 'PACKAGING PREP')
    .replace('GALLERY', 'ASSET GALLERY')
    .replace('COUNT', 'BIN COUNT')
    .replace('ROD CUTS', 'ROD CUTS & RING PACKS')
    // The vendor dock: a purchase order arrives, its lines are received onto a cart, labelled, and
    // put away — and any order that was waiting on those pieces is offered them before they vanish
    // onto the shelf.
    .replace('RECEIVING', 'RECEIVING (PO)');
