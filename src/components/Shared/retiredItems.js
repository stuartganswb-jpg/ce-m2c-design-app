import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

// Retired items are "notated" by NetSuite INTERNAL ID in system/retired_items (locked from the Stock
// View → OLD Sales History report). Internal IDs are stable across an item# rename, so hiding by them
// survives dropping the " - OLD" suffix in NetSuite.
//
// These are hidden from USER-FACING browse/select surfaces (Stock View, Master Library, pick/pack
// count, CPQ item pickers). Data / ERP tabs (NetSuite Sync, ERP Push/Pull, Admin) deliberately do NOT
// filter — they must still see every item to sync and map it.
export const useRetiredSet = () => {
    const [set, setSet] = useState(() => new Set());
    useEffect(() => onSnapshot(
        doc(db, 'system', 'retired_items'),
        s => setSet(new Set(((s.exists() && s.data().internalIds) || []).map(String))),
        () => setSet(new Set())
    ), []);
    return set;
};

// Predicate: true when the part is NOT retired. Retired = locked by internal ID (set) OR flagged
// manufacturingSpecs.isRetired (custitem28, set by the NetSuite sync).
export const notRetired = (set) => (p) => {
    if (p && p.manufacturingSpecs && p.manufacturingSpecs.isRetired === true) return false;
    return !(set && set.has(String((p && p.netSuiteInternalId) ?? '')));
};
