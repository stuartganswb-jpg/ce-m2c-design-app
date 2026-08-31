import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, setDoc, updateDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import ProgramPrintUploader from './ProgramPrintUploader';
import {
    buildPartIndex, resolveBaseDoc, plateInfoOf, parseRenderFilename,
    buildComboMeta, buildSingleMeta, pairedCandidatesFor, pairedInfoOf, partCodeOf,
    fabricutCodesOfDoc, fabricutCodeForFinish, ourFinishNameOf, fabricutColorNameOf,
    END_TREATMENT_LABELS, DIA_LABELS, PROJ_LABELS,
} from './fabricutAssetTags';
import { IMG_GALLERY, imageUpdate, photoMayOverwrite, splitCode, normFinish } from './partImage';
import { parsePillowFolder, matchPillowPart, galleryIdsFor } from './pillowCodes';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const BatchImageProcessor = ({ activeBrand, currentUser }) => {
    // queue entries: { file, folder } — folder = the containing folder's name when the batch came
    // in via SELECT FOLDER (Kermit renders: folder name IS the plate code), '' for loose files.
    const [libraryError, setLibraryError] = useState('');
    const [stampFails, setStampFails] = useState([]);   // library writes this login was not allowed
    const [queue, setQueue] = useState([]);
    // ONE IMAGE BECOMES THE THUMBNAIL (Stuart 2026-08-27: "apply one as the thumbnail for the
    // master library"). A folder holds several photographs of the same pillow; they all belong in
    // the gallery, but exactly one is the item's picture. Defaults to the FIRST image of each
    // folder and is a tick the operator can move to any other.
    const [useAsThumb, setUseAsThumb] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [autoRun, setAutoRun] = useState(null); // { done, total } while PROCESS REST OF FOLDER runs

    const [hqParts, setHqParts] = useState([]);
    const [globalLists, setGlobalLists] = useState({ prodTypes: [], customers: [] });
    const [crmCustomers, setCrmCustomers] = useState([]);

    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [inhouseFinishes, setInhouseFinishes] = useState([]);
    const [masterFinishes, setMasterFinishes] = useState([]);
    const [collectionsData, setCollectionsData] = useState([]);

    const [patternId, setPatternId] = useState("");
    const [finishId, setFinishId] = useState("");
    const [fabCode, setFabCode] = useState("");
    const [fabColorName, setFabColorName] = useState("");

    const [customerId, setCustomerId] = useState("");
    const [clientSku, setClientSku] = useState("");

    const [collectionName, setCollectionName] = useState("");
    // Flag every import for the customer portal gallery under the selected COLLECTION — the same
    // portalCollections/portalVisible stamp the gallery's bulk 🌐 FLAG FOR PORTAL writes, applied
    // at import time so the re-tag pass isn't needed (Stuart 2026-07-27: "just add the check box
    // on the batch processor... the customer id and color name are already there").
    const [portalEnable, setPortalEnable] = useState(false);
    const [productType, setProductType] = useState("");
    const [notes, setNotes] = useState("");
    const [associatedParts, setAssociatedParts] = useState([]);
    const [associatedFinishes, setAssociatedFinishes] = useState([]);

    // per-folder sticky settings: { [folderKey]: { pairedDocId, crop } }.
    // crop = { x, y, w, h } as fractions of the image's natural size — set on the first image of a
    // folder, applied to every image processed under that folder (the renders are identical frames).
    const [folderMeta, setFolderMeta] = useState({});
    const [pairedQuery, setPairedQuery] = useState("");
    // THE FIRST QUESTION per folder: which bracket arm / fee item is combined with this plate in
    // these renders? Opens automatically on the first image of every not-yet-paired folder.
    const [pairPrompt, setPairPrompt] = useState(null); // { folder } | null
    const [pairPromptQuery, setPairPromptQuery] = useState("");
    const [cropMode, setCropMode] = useState(false);
    const [dragRect, setDragRect] = useState(null); // live drag, fractions
    const dragStartRef = useRef(null);
    const cropBoxRef = useRef(null);

    const [imagePreview, setImagePreview] = useState(null);
    const [mode, setMode] = useState('images'); // 'images' (existing conveyor) | 'prints' (PDF program-print uploader)
    const idInputRef = useRef(null);

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
                if (docSnap.exists()) {
                    setGlobalLists({
                        prodTypes: docSnap.data().prodTypes || [],
                        customers: docSnap.data().customers || []
                    });
                    setProductType(docSnap.data().prodTypes?.[0] || '');
                }
            });
        } catch (err) { console.error("Global Lists Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(collection(db, "hq_collections"), snap => {
                setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()})));
            });
        } catch (err) { console.error("Collections DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    // Customer dropdown comes from the CRM (crm_records CUSTOMER), not the legacy master_lists.
    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(collection(db, "crm_records"), snap => {
                setCrmCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.type === 'CUSTOMER'));
            }, e => console.warn("CRM records missing"));
        } catch (err) { console.error("CRM DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub = null;
        try {
            // A DENIED READ USED TO LOOK LIKE AN EMPTY LIBRARY (Stuart 2026-08-27: "works from my
            // machine but not associates? hers is pc … and role level access only differences").
            // This was the ONE listener in the file with no error callback, so if a login cannot
            // read Approved_Designs the snapshot errors, hqParts stays [], and every folder reports
            // "not in the Master Library" — the same words as a genuinely wrong folder name. The
            // person is then told their filing is wrong when it is their permissions. Say which.
            unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
                if (!snap || !snap.docs) return;
                setLibraryError('');
                setHqParts(snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })));
            }, (e) => {
                console.error("Master Library read failed:", e);
                setLibraryError(String(e?.code || e?.message || e));
            });
        } catch (err) { console.error("HQ DB Error:", err); setLibraryError(String(err?.message || err)); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub1, unsub2, unsub3, unsub4;
        try {
            unsub1 = onSnapshot(collection(db, "hq_global_finishes"), snap => setGlobalFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Global Finishes"));
            unsub2 = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Outsource Finishes"));
            unsub3 = onSnapshot(collection(db, "hq_inhouse_finishes"), snap => setInhouseFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Inhouse Finishes"));
            unsub4 = onSnapshot(doc(db, "system", "master_finishes"), docSnap => { if (docSnap.exists()) setMasterFinishes(docSnap.data().finishes || []); }, e => console.warn("Missing Master Finishes"));
        } catch (err) { console.error("Finishes DB Error:", err); }
        return () => {
            [unsub1, unsub2, unsub3, unsub4].forEach(u => { if (typeof u === 'function') u(); });
        };
    }, []);

    const safeHqParts = Array.isArray(hqParts) ? hqParts : [];
    const allFinishes = [...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])];
    const partIndex = useMemo(() => buildPartIndex(hqParts), [hqParts]);
    const finishLists = useMemo(() => [masterFinishes, globalFinishes, outsourceFinishes, inhouseFinishes], [masterFinishes, globalFinishes, outsourceFinishes, inhouseFinishes]);

    // CRM customers first, legacy master_lists names appended for anything not in the CRM yet.
    const customerOptions = useMemo(() => {
        const names = crmCustomers.map(r => String(r.companyName || r.name || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
        const seen = new Set(names.map(n => n.toUpperCase()));
        (globalLists.customers || []).forEach(c => { const n = String(c || '').trim(); if (n && !seen.has(n.toUpperCase())) { seen.add(n.toUpperCase()); names.push(n); } });
        return names;
    }, [crmCustomers, globalLists.customers]);

    const handleFileSelect = (e) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).filter(f => f && f.type && f.type.startsWith('image/'));
        if (files.length === 0) return;
        setQueue(prev => [...prev, ...files.map(file => ({ file, folder: '' }))]);
    };

    // SELECT FOLDER(S): the folder name is the plate code (H1-1BP-R…); works selecting one plate
    // folder or the parent holding several — each file keeps its immediate parent as its folder.
    const handleFolderSelect = (e) => {
        if (!e.target.files) return;
        const entries = Array.from(e.target.files)
            .filter(f => f && f.type && f.type.startsWith('image/'))
            .map(file => {
                const segs = String(file.webkitRelativePath || '').split('/');
                return { file, folder: segs.length >= 2 ? segs[segs.length - 2] : '' };
            });
        if (entries.length === 0) return;
        entries.sort((a, b) => (a.folder + a.file.name).localeCompare(b.folder + b.file.name));
        setQueue(prev => [...prev, ...entries]);
        e.target.value = '';
    };

    useEffect(() => {
        if (Array.isArray(queue) && queue.length > 0 && currentIndex < queue.length) {
            const entry = queue[currentIndex];
            const file = entry?.file;
            if (!file) return;

            let objectUrl = null;
            try {
                objectUrl = URL.createObjectURL(file);
                setImagePreview(objectUrl);
            } catch (err) { console.warn("Failed to read file", err); }

            const parsed = parseRenderFilename(file.name);
            // UNIQUITY SOFT GOODS (Stuart 2026-08-27): the folder carries the whole identity —
            // "Bubley 01 20x12" IS Bubley/01P20x12. Read it, resolve it against the library, and
            // fill the form from what the LIBRARY says rather than from the folder's spelling; the
            // banner below shows both so a folder that does not resolve is obvious before upload.
            const soft = softGoodsOf(entry);
            if (soft && soft.hit) {
                const ids = galleryIdsFor(soft.libCode);
                setPatternId(ids.patternId);
                setFinishId(ids.finishId);
                setFabCode("");
                setFabColorName("");
                // Take the product type from the ITEM (PILLOW / THROW), not from whatever the
                // dropdown happened to be left on — the gallery filters on it.
                const pt = soft.hit.manufacturingSpecs?.productType || soft.hit.productType || '';
                if (pt) setProductType(String(pt).toUpperCase());
            } else if (entry.folder) {
                // Kermit render folder: ONLY the folder name (plate code) and the finish/color
                // token are trustworthy — the filename's Fabricut code is usually WRONG, so it is
                // ignored; the code autofills from the CrossReference import (or the folder-sticky
                // manual entry) instead.
                setPatternId(entry.folder.toUpperCase());
                setFinishId(parsed?.finishId || "");
                setFabCode("");
                setFabColorName(parsed?.fabColorName || "");
            } else {
                setFabCode(parsed?.fabCode || "");
                setFabColorName(parsed?.fabColorName || "");
                let rawName = String(file.name || "").split('.')[0].toUpperCase();
                let parts = rawName.split('_');
                if (parts.length === 1) parts = rawName.split('-');

                if (parts.length > 1 && parts[parts.length - 1].length <= 6) {
                    setFinishId(parts.pop());
                    setPatternId(parts.join('-'));
                } else {
                    setPatternId(rawName);
                    setFinishId("");
                }
            }
            // First image of this folder (or a loose file) → offer it as the thumbnail.
            const firstOfFolder = entry.folder
                ? queue.findIndex(q => q.folder === entry.folder) === currentIndex
                : true;
            setUseAsThumb(firstOfFolder);
            setCropMode(false);
            setDragRect(null);

            if (idInputRef.current) idInputRef.current.focus();

            return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
        } else {
            setImagePreview(null);
        }
    }, [currentIndex, queue]);

    // ── SOFT GOODS: FOLDER → ITEM (Uniquity pillows & throws) ──────────────────────────────────
    // Parses the folder, then asks the LIBRARY whether that item exists. A folder is filing, not a
    // key — so nothing is imported against a code the library does not have. `hit` is the item
    // itself; without one the operator is shown what was read and what was missing, and types it.
    const softGoodsFor = useMemo(() => {
        const cache = new Map();
        return (folder) => {
            if (!folder) return null;
            if (cache.has(folder)) return cache.get(folder);
            const parsed = parsePillowFolder(folder);
            const m = parsed ? matchPillowPart(parsed, safeHqParts) : null;
            const out = parsed ? {
                parsed,
                hit: m ? m.part : null,
                matchedBy: m ? m.matchedBy : '',
                libCode: m ? String(m.part.legacyErpId || m.part.itemId || '') : (parsed.code || ''),
            } : null;
            cache.set(folder, out);
            return out;
        };
    }, [safeHqParts]);

    // THE FILE NAME IS A SECOND WITNESS (Ashley 2026-08-31). Her folder reached the browser as
    // "Dalton27P23x23" while the files inside were "Dalton_27P23x23-corner.jpg" — the same identity,
    // spelled two ways, in one drop. Whichever of the two resolves to a real library item is used;
    // the folder is asked first because it describes the whole batch, and the filename only gets a
    // say when the folder produced nothing. A shot word like "-corner" is ignored either way.
    const softGoodsOf = useMemo(() => (entry) => {
        if (!entry) return null;
        const byFolder = entry.folder ? softGoodsFor(entry.folder) : null;
        if (byFolder && byFolder.hit) return byFolder;
        const fname = String(entry.file?.name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
        const byFile = fname ? softGoodsFor(fname) : null;
        if (byFile && byFile.hit) return { ...byFile, from: 'filename' };
        return byFolder || byFile || null;
    }, [softGoodsFor]);

    const folderKey = queue[currentIndex]?.folder || '~loose~';
    const currentFolderMeta = folderMeta[folderKey] || {};

    // Prompt for the folder's combo partner the moment its first image comes up; `pairedChosen`
    // (set by picking an item OR "plate only") keeps it from re-asking within the same folder —
    // every NEW folder asks again, so everything ends up tagged.
    useEffect(() => {
        const entry = queue[currentIndex];
        if (!entry || !entry.folder || autoRun) { setPairPrompt(null); return; }
        // A pillow has no bracket arm and no return fee — the combo question is a hardware
        // question, and asking it on every soft-goods folder would be pure friction.
        if (softGoodsOf(entry)?.hit) { setPairPrompt(null); return; }
        const fm = folderMeta[entry.folder] || {};
        if (!fm.pairedChosen) { setPairPrompt({ folder: entry.folder }); setPairPromptQuery(""); }
        else setPairPrompt(null);
    }, [currentIndex, queue, folderMeta, autoRun]);
    const pairedDoc = currentFolderMeta.pairedDocId ? safeHqParts.find(p => p.id === currentFolderMeta.pairedDocId) : null;
    const pairedInfo = pairedDoc ? pairedInfoOf(pairedDoc) : null;
    const activeCrop = currentFolderMeta.crop || null;

    const setFolderField = (patch) => setFolderMeta(prev => ({ ...prev, [folderKey]: { ...(prev[folderKey] || {}), ...patch } }));

    // Library resolution of the typed pattern (exact, species-aware — not substring)
    const resolved = useMemo(() => {
        const r = resolveBaseDoc(patternId, partIndex);
        if (!r.doc) return null;
        const plate = plateInfoOf(r.base, r.doc);
        const sk = r.doc.manufacturingSpecs?.customData?.sizeKey;
        const bits = [];
        if (plate) bits.push(plate.isCover ? 'COVERPLATE (UPGRADE)' : 'BACKPLATE (INCL. W/ ARM)', plate.orientation);
        if (sk) bits.push(DIA_LABELS[sk.dia] || sk.dia, PROJ_LABELS[sk.projLetter] || '');
        return { ...r, plate, summary: bits.filter(Boolean).join(' · ') };
    }, [patternId, partIndex]);

    // FABRICUT CODE resolution — the CrossReference import is the source of truth (filenames are
    // not). Priority: folder-sticky manual entry → tier-aware code (per this image's finish) off
    // the paired fee/arm doc, then the plate doc. libFabCodes only sanity-checks manual entries.
    const libFabCodes = useMemo(
        () => [...new Set([...fabricutCodesOfDoc(resolved?.doc), ...fabricutCodesOfDoc(pairedDoc)])],
        [resolved, pairedDoc]
    );
    const autoFabCode = useMemo(() => {
        const clean = String(finishId).toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1');
        return String(currentFolderMeta.fabCode || '').toUpperCase()
            || fabricutCodeForFinish(pairedDoc, clean)
            || fabricutCodeForFinish(resolved?.doc, clean)
            || '';
    }, [finishId, currentFolderMeta.fabCode, pairedDoc, resolved]);
    useEffect(() => {
        if (!fabCode && autoFabCode) setFabCode(autoFabCode);
    }, [fabCode, autoFabCode]);
    const fabCodeStatus = !fabCode ? (queue[currentIndex]?.folder ? { ok: false, txt: pairedInfo?.role === 'FEE'
            ? '⚠ REQUIRED — returns are FEE items: the CrossReference sheet has no Fabricut code for them (plate rows only carry bracket codes). Enter the catalog code once — it sticks for the whole folder.'
            : '⚠ REQUIRED — no Fabricut code on the CrossReference import for this item; enter it (sticks for the whole folder)' } : null)
        : !libFabCodes.length ? null
        : libFabCodes.includes(String(fabCode).trim().toUpperCase())
            ? { ok: true, txt: '✓ matches CrossReference import' }
            : { ok: false, txt: `⚠ not on the imported CrossReference for this item (has: ${libFabCodes.slice(0, 3).join(', ')}${libFabCodes.length > 3 ? '…' : ''})` };

    // IMPORT GATE — Fabricut items don't import unless identified BOTH ways: our item # resolves
    // in the Master Library AND a Fabricut code is present. Missing info is entered right then.
    // The import gate. FABRICUT assets must carry our item # AND a Fabricut code — that is what
    // makes them findable to Christie and to the portal. SOFT GOODS (Uniquity pillows/throws) have
    // no Fabricut identity at all and their pattern is not a standalone library doc — "Bubley" is
    // not an item, "Bubley/01P20x12" is. For those the question is simply: did the folder resolve
    // to a real library item? Asking a Fabricut question of a pillow would block every import.
    const missingFor = (m, soft) => {
        const out = [];
        if (soft) {
            if (!soft.hit) out.push(`OUR ITEM # (folder "${soft.parsed?.pattern || ''}" → ${soft.libCode || 'nothing'} is not in the Master Library)`);
            return out;
        }
        if (!resolveBaseDoc(m.patternId, partIndex).doc) out.push('OUR ITEM # (no Master Library match)');
        if (!m.finishId) out.push('FINISH ID');
        if (!m.fabCode) out.push('FABRICUT CODE');
        return out;
    };

    // Mid-run "fix it now" popup: the folder loop pauses on an unidentifiable image and waits for
    // this modal (save / skip / stop) before anything is written.
    const fixResolverRef = useRef(null);
    const [fixModal, setFixModal] = useState(null);
    const requestFix = (data) => new Promise(resolve => {
        fixResolverRef.current = resolve;
        let previewUrl = null;
        try { previewUrl = URL.createObjectURL(data.file); } catch (e) { /* preview optional */ }
        setFixModal({ ...data, previewUrl, values: { finishId: data.finishId || '', fabCode: data.fabCode || '', fabColorName: data.fabColorName || '' } });
    });
    const closeFix = (result) => {
        setFixModal(fm => { if (fm?.previewUrl) { try { URL.revokeObjectURL(fm.previewUrl); } catch (e) {} } return null; });
        const r = fixResolverRef.current;
        fixResolverRef.current = null;
        if (r) r(result);
    };

    // FABRICUT COLOR NAME — authoritative source is the Master Finishes library (tab 4.5): the
    // clientMapping name loaded for the CRM customer "Fabricut" on this finish. Filenames carry
    // typos, so once 4.5 has the name it OVERRIDES the parse; until then blanks fill from our own
    // finish name. Manual edits stick (this only fires on image/finish change).
    useEffect(() => {
        const authName = fabricutColorNameOf(finishId, finishLists);
        if (authName) { setFabColorName(authName); return; }
        setFabColorName(prev => prev || ourFinishNameOf(finishId, finishLists));
    }, [currentIndex, finishId, finishLists]);

    // ----- CROP TOOL -----
    const fracPoint = (e) => {
        const box = cropBoxRef.current?.getBoundingClientRect();
        if (!box || !box.width || !box.height) return null;
        return {
            x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
            y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
        };
    };
    const onCropDown = (e) => {
        if (!cropMode) return;
        e.preventDefault();
        const p = fracPoint(e);
        if (p) { dragStartRef.current = p; setDragRect({ x: p.x, y: p.y, w: 0, h: 0 }); }
    };
    const onCropMove = (e) => {
        if (!cropMode || !dragStartRef.current) return;
        const p = fracPoint(e);
        if (!p) return;
        const s = dragStartRef.current;
        setDragRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
    };
    const onCropUp = () => {
        if (!cropMode || !dragStartRef.current) return;
        dragStartRef.current = null;
        setDragRect(rect => {
            if (rect && rect.w > 0.02 && rect.h > 0.02) {
                setFolderField({ crop: rect });
                setCropMode(false);
            }
            return null;
        });
    };

    // ----- IMAGE PIPELINE (crop → hi-res + watermarked thumb) -----
    const generateWatermarkedImages = (file, textStr, crop) => {
        return new Promise((resolve) => {
            if (!file) return resolve({ hiResBlob: null, thumbBlob: null });
            const img = new Image();
            img.onload = () => {
                try {
                    const sx = crop ? crop.x * img.width : 0;
                    const sy = crop ? crop.y * img.height : 0;
                    const sw = crop ? Math.max(1, crop.w * img.width) : img.width;
                    const sh = crop ? Math.max(1, crop.h * img.height) : img.height;

                    const makeThumb = (hiResBlob) => {
                        const thCanvas = document.createElement('canvas');
                        const thCtx = thCanvas.getContext('2d');
                        thCanvas.width = 250;
                        thCanvas.height = 250;
                        const minDim = Math.min(sw, sh);
                        const cx = sx + (sw - minDim) / 2;
                        const cy = sy + (sh - minDim) / 2;
                        thCtx.drawImage(img, cx, cy, minDim, minDim, 0, 0, 250, 250);

                        const thFontSize = 14;
                        thCtx.font = `bold ${thFontSize}px monospace`;
                        const thPad = thFontSize * 0.4;
                        const thTxtW = thCtx.measureText(textStr).width;

                        const thBoxX = 250 - thTxtW - thPad * 3;
                        const thBoxY = 250 - thFontSize - thPad * 3;

                        thCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                        thCtx.fillRect(thBoxX, thBoxY, thTxtW + thPad * 2, thFontSize + thPad * 2);
                        thCtx.fillStyle = '#333333';
                        thCtx.textBaseline = 'top';
                        thCtx.fillText(textStr, thBoxX + thPad, thBoxY + thPad * 1.5);

                        thCanvas.toBlob((thBlob) => {
                            resolve({ hiResBlob, thumbBlob: thBlob });
                        }, 'image/png', 0.9);
                    };

                    if (crop) {
                        const hiCanvas = document.createElement('canvas');
                        hiCanvas.width = Math.round(sw);
                        hiCanvas.height = Math.round(sh);
                        hiCanvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, hiCanvas.width, hiCanvas.height);
                        hiCanvas.toBlob((hiBlob) => makeThumb(hiBlob || file), 'image/png', 1.0);
                    } else {
                        makeThumb(file);
                    }
                } catch (err) { resolve({ hiResBlob: file, thumbBlob: null }); }
            };
            img.onerror = () => resolve({ hiResBlob: file, thumbBlob: null });
            try { img.src = URL.createObjectURL(file); } catch (e) { resolve({ hiResBlob: file, thumbBlob: null }); }
        });
    };

    // Upload one image + write its global_assets doc. `meta` is fully explicit so the
    // process-rest-of-folder loop can run without touching form state.
    const processOne = async (file, meta) => {
        const safePattern = String(meta.patternId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
        // EP finishes were erroneously zero-padded (EP01 should be EP1) — strip it so gallery
        // codes match the EP1..EP6 used on library parts. ONLY EP: P##/S## finishes are
        // canonically zero-padded (master_finishes P01-P30, S01-S12), so leave those alone.
        const cleanFinish = String(meta.finishId).toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1');
        const safeFinish = cleanFinish.replace(/[^A-Z0-9-]/g, '');
        const displayId = safeFinish ? `${String(meta.patternId).toUpperCase()}/${safeFinish}` : String(meta.patternId).toUpperCase();
        const safeUrlId = safeFinish ? `${safePattern}_${safeFinish}` : safePattern;

        const brandFolder = activeBrand ? String(activeBrand) : 'global';

        // Fabricut identity: two-part combo (plate + fee/arm) when a paired item is set,
        // otherwise single-item resolution. Both are additive — non-Fabricut ids stamp nothing.
        const base = resolveBaseDoc(meta.patternId, partIndex);
        const derived = meta.pairedDoc
            ? buildComboMeta({ plateCode: base.base || meta.patternId, pairedDoc: meta.pairedDoc, finishId: safeFinish, fabCode: meta.fabCode, fabColorName: meta.fabColorName, partIndex, finishLists })
            : buildSingleMeta({ patternId: meta.patternId, finishId: safeFinish, partIndex, finishLists });

        const { hiResBlob, thumbBlob } = await generateWatermarkedImages(file, displayId, meta.crop || null);

        const uniqueTimestamp = Date.now();
        const uniqueSuffix = Math.floor(Math.random() * 10000);
        const hiResRef = ref(storage, `global_assets/hires/${brandFolder}/${safeUrlId}_${uniqueTimestamp}_${uniqueSuffix}_original.png`);

        let hiResUrl = null;
        let thumbUrl = null;

        if (hiResBlob && thumbBlob) {
            const thumbRef = ref(storage, `global_assets/thumbs/${brandFolder}/${safeUrlId}_${uniqueTimestamp}_${uniqueSuffix}_thumb.png`);
            const [hiUpload, thUpload] = await Promise.all([
                uploadBytes(hiResRef, hiResBlob),
                uploadBytes(thumbRef, thumbBlob)
            ]);
            const urls = await Promise.all([ getDownloadURL(hiUpload.ref), getDownloadURL(thUpload.ref) ]);
            hiResUrl = urls[0];
            thumbUrl = urls[1];
        } else {
            const fallbackUpload = await uploadBytes(hiResRef, file);
            hiResUrl = await getDownloadURL(fallbackUpload.ref);
            thumbUrl = hiResUrl;
        }

        const assetDocId = `ASSET-${brandFolder}-${safeUrlId}-${uniqueTimestamp}-${uniqueSuffix}`;
        const mergedParts = [...new Set([...(Array.isArray(meta.associatedParts) ? meta.associatedParts : []), ...((derived && derived.associatedParts) || [])])];

        await setDoc(doc(db, "global_assets", assetDocId), {
            id: assetDocId,
            patternId: String(meta.patternId).toUpperCase(),
            finishId: safeFinish,
            customerId: meta.customerId || '',
            clientSku: String(meta.clientSku || '').toUpperCase(),
            name: (derived && derived.name) || displayId,
            collection: meta.collectionName || '',
            productType: meta.productType || '',
            notes: meta.notes || '',
            associatedParts: mergedParts,
            associatedFinishes: Array.isArray(meta.associatedFinishes) ? meta.associatedFinishes : [],
            fabCode: String(meta.fabCode || '').toUpperCase(),
            ...(derived ? { fab: derived.fab, tags: derived.tags } : {}),
            ...(meta.portalFlag ? { portalCollections: [meta.portalFlag], portalVisible: true } : {}),
            originalUrl: hiResUrl,
            thumbnailUrl: thumbUrl,
            url: thumbUrl,
            brandId: activeBrand || 'ALL',
            uploadedBy: currentUser || 'Unknown',
            createdAt: serverTimestamp()
        }, { merge: true });

        // ── THE IMPORT LANDS ON THE ITEM (Stuart 2026-08-27) ───────────────────────────────────
        // "i just imported images for H1-75BF and H1-75GF … all imported fine but the images are
        //  not showing up on the items in the master library."
        //
        // They imported correctly — into global_assets. Nothing carried them the last step onto the
        // library part, and the one tool that did (Library → Sync Thumbnails) is a button nobody
        // was told to press AND skipped base codes: it required a '/' in legacyErpId, so H1-75BF —
        // a finial imported PLATE ONLY, which is exactly a base code — was excluded by construction.
        //
        // So the upload now stamps the picture itself, on the base doc and on the finish variant
        // for THIS finish. photoMayOverwrite lets a photograph replace a .glb render or an
        // inherited stand-in, and refuses to touch another photograph.
        // Only the image marked as the thumbnail becomes the item's picture. The rest still land
        // in the gallery — a folder of eight photographs is eight assets and one thumbnail, not
        // eight fights over the same field where the last upload silently wins.
        try {
            if (!meta.setAsThumbnail) return;
            const targets = [];
            if (base && base.doc) targets.push(base.doc);
            if (safeFinish) {
                const want = `${String(base?.base || meta.patternId).toUpperCase()}/${normFinish(safeFinish)}`;
                (partIndex?.list || []).forEach(p => {
                    const k = splitCode(p.legacyErpId || p.itemId);
                    if (k && `${k.pattern}/${k.finish}` === want) targets.push(p);
                });
            }
            // Base-part map, so a variant still showing its BASE's picture is recognised as the
            // inherited stand-in it is rather than mistaken for its own photograph.
            const byBase = new Map();
            (partIndex?.list || []).forEach(p => { const k = splitCode(p.legacyErpId || p.itemId); if (k && !k.finish) byBase.set(k.pattern, p); });
            const seen = new Set();
            for (const t of targets) {
                if (!t || !t.id || seen.has(t.id)) continue;
                seen.add(t.id);
                if (!photoMayOverwrite(t, byBase)) continue;           // a real photo already there
                await updateDoc(doc(db, 'Approved_Designs', t.id), imageUpdate(thumbUrl, IMG_GALLERY));
            }
        } catch (e) {
            // The asset itself is written and safe, so this must never fail the upload — but it must
            // not be invisible either. It was a console.warn, which meant an operator whose login
            // cannot write the Master Library saw a completely successful import and no picture,
            // with nothing on screen to explain it. Collected and surfaced when the batch ends.
            console.warn('Image stamped to gallery but not onto the library part:', e);
            const code = String(e?.code || e?.message || e);
            setStampFails(prev => prev.length >= 25 ? prev : [...prev, { code: displayId, why: code }]);
        }
    };

    const metaFromForm = () => ({
        patternId, finishId, fabCode, fabColorName,
        pairedDoc, crop: activeCrop,
        customerId, clientSku, collectionName, productType, notes,
        associatedParts, associatedFinishes,
        portalFlag: portalEnable ? String(collectionName || '').trim().toUpperCase() : '',
        setAsThumbnail: useAsThumb,
    });

    const handleProcessAndNext = async (e) => {
        if (e) e.preventDefault();
        if (!patternId) return alert("You must provide a Pattern ID.");
        if (portalEnable && !String(collectionName || '').trim()) return alert("Portal flagging needs a COLLECTION — the portal shows an asset only to customers entitled to its collection. Pick one (e.g. Fabricut H1) or un-tick the portal box.");
        if (queue[currentIndex]?.folder) {
            // Fabricut folder conveyor: hard gate — identify with OUR item # AND a Fabricut code.
            const missing = missingFor(metaFromForm(), softGoodsOf(queue[currentIndex]));
            if (missing.length) return alert(`NOT IMPORTED — missing: ${missing.join(' · ')}.\nEnter it now; Fabricut assets must be identified by our item # and a matching Fabricut code.`);
        } else if (/^H1-/i.test(String(patternId).trim()) && !resolved) {
            if (!window.confirm("This H1 pattern does not resolve to a Master Library item — import anyway?")) return;
        }

        setIsProcessing(true);

        if (!Array.isArray(queue) || !queue[currentIndex]) {
            setIsProcessing(false);
            return;
        }

        try {
            await processOne(queue[currentIndex].file, metaFromForm());
            setNotes("");
            setClientSku("");
            setCurrentIndex(prev => prev + 1);
            setIsProcessing(false);
        } catch (error) {
            console.error("Processing Error:", error);
            alert("Failed to process image. Check console.");
            setIsProcessing(false);
        }
    };

    // Blast through every remaining image of the current folder: same plate/paired/crop/fields;
    // each file is scanned for its OWN finish/color token; the Fabricut code comes from the
    // folder-sticky entry or the CrossReference import (tier-aware per finish) — NEVER the
    // filename. Anything unidentifiable pauses the run in a fix-it-now popup before saving.
    const remainingInFolder = queue.filter((q, i) => i > currentIndex && q.folder && q.folder === queue[currentIndex]?.folder);
    const handleProcessFolder = async () => {
        const baseMeta = metaFromForm();
        if (portalEnable && !baseMeta.portalFlag) return alert("Portal flagging needs a COLLECTION — pick one (e.g. Fabricut H1) or un-tick the portal box before running the folder.");
        const soft = softGoodsOf(queue[currentIndex]);
        const missing = missingFor(baseMeta, soft);
        if (missing.length) return alert(`NOT IMPORTED — missing: ${missing.join(' · ')}.\n${soft ? 'Fix the folder name, or type our item # by hand, before running the folder.' : 'Set up the first image completely (our item #, finish, Fabricut code) before running the folder.'}`);
        const idxs = [currentIndex];
        queue.forEach((q, i) => { if (i > currentIndex && q.folder && q.folder === queue[currentIndex]?.folder) idxs.push(i); });
        const stickyFab = String(folderMeta[folderKey]?.fabCode || '').toUpperCase();
        const plateDocForRun = resolveBaseDoc(baseMeta.patternId, partIndex).doc;
        setIsProcessing(true);
        setAutoRun({ done: 0, total: idxs.length });
        let stopped = false, skipped = 0;
        try {
            for (let n = 0; n < idxs.length && !stopped; n++) {
                const entry = queue[idxs[n]];
                let meta = baseMeta;
                // SOFT GOODS: every image in the folder is the SAME pillow, so the identity comes
                // from the FOLDER and is not re-read per file. The Fabricut branch below scans each
                // filename for its own finish — correct there, where one folder holds one plate in
                // twenty finishes, and exactly wrong here, where it would strip the identity off
                // every image after the first.
                if (soft && soft.hit) {
                    // When the identity came from the FILE rather than the folder, each file must be
                    // read on its own — the folder is not the thing that identified this batch, and
                    // assuming it would tag every image as whatever the first one happened to be.
                    const per = soft.from === 'filename' ? softGoodsOf(entry) : null;
                    const ids = per && per.hit ? galleryIdsFor(per.libCode) : null;
                    meta = {
                        ...baseMeta,
                        ...(ids ? { patternId: ids.patternId, finishId: ids.finishId } : {}),
                        setAsThumbnail: n === 0 && baseMeta.setAsThumbnail,
                    };
                } else if (n > 0) {
                    const parsed = parseRenderFilename(entry.file.name);
                    const fin = parsed?.finishId || '';
                    const perFab = stickyFab || fabricutCodeForFinish(pairedDoc, fin) || fabricutCodeForFinish(plateDocForRun, fin) || baseMeta.fabCode || '';
                    const color = fabricutColorNameOf(fin, finishLists) || parsed?.fabColorName || ourFinishNameOf(fin, finishLists) || '';
                    meta = { ...baseMeta, finishId: fin, fabCode: perFab, fabColorName: color, setAsThumbnail: false };
                    if (!fin || !perFab) {
                        const fix = await requestFix({
                            file: entry.file, folder: entry.folder,
                            finishId: fin, fabCode: perFab, fabColorName: color,
                            reasons: [
                                ...(!fin ? ['FINISH ID not readable from the filename'] : []),
                                ...(!perFab ? ['no FABRICUT CODE on the CrossReference import for this item'] : []),
                            ],
                        });
                        if (fix.action === 'stop') { stopped = true; setCurrentIndex(idxs[n]); break; }
                        if (fix.action === 'skip') { skipped++; setAutoRun({ done: n + 1, total: idxs.length }); setCurrentIndex(idxs[n] + 1); continue; }
                        meta = { ...meta, ...fix.values };
                    }
                }
                await processOne(entry.file, meta);
                setAutoRun({ done: n + 1, total: idxs.length });
                setCurrentIndex(idxs[n] + 1);
            }
            if (!stopped) { setNotes(""); setClientSku(""); }
        } catch (error) {
            console.error("Folder Processing Error:", error);
            alert(`Folder run stopped after an upload error — the current image is the one that failed. Check console.`);
        }
        setAutoRun(null);
        setIsProcessing(false);
        if (skipped) alert(`${skipped} image${skipped === 1 ? '' : 's'} skipped (missing info) — nothing was written for ${skipped === 1 ? 'it' : 'them'}.`);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isProcessing && patternId) handleProcessAndNext();
        }
    };

    const safeQueue = Array.isArray(queue) ? queue : [];
    const remaining = Math.max(0, safeQueue.length - currentIndex);
    const isDone = safeQueue.length > 0 && currentIndex >= safeQueue.length;
    const visibleQueue = safeQueue.slice(currentIndex, currentIndex + 50);

    const pairedSuggestions = useMemo(() => {
        if (!queue[currentIndex]) return [];
        return pairedCandidatesFor(patternId, partIndex, pairedQuery);
    }, [patternId, partIndex, pairedQuery, queue, currentIndex]);

    const pairPromptSuggestions = useMemo(() => {
        if (!pairPrompt) return [];
        return pairedCandidatesFor(pairPrompt.folder, partIndex, pairPromptQuery);
    }, [pairPrompt, partIndex, pairPromptQuery]);

    // ── THE WAY OUT (Stuart 2026-08-27: "there is no cancel or way out once you go in") ────────
    // Loading a folder committed you to it: the only exit was SKIP THIS IMAGE, one press per file,
    // or reaching the end. On a folder of eighty photographs that is not an exit. Both escapes are
    // additive — nothing already uploaded is touched, because those assets are saved and real.
    const resetBatch = () => {
        setQueue([]); setCurrentIndex(0);
        setPatternId(''); setFinishId(''); setFabCode(''); setFabColorName('');
        setCustomerId(''); setClientSku(''); setNotes('');
        setAssociatedParts([]); setAssociatedFinishes([]); setFolderMeta({});
        setCropMode(false); setDragRect(null); setAutoRun(null); setPairPrompt(null);
    };
    const cancelBatch = () => {
        if (isProcessing) return alert('An upload is in flight — wait for it to finish, then cancel.');
        const left = safeQueue.length - currentIndex;
        if (left > 0 && !window.confirm(`Leave this batch?\n\n${left} image(s) not yet processed will be dropped from the queue.\n\nAnything already uploaded stays in the Asset Gallery — this only clears what is waiting.`)) return;
        resetBatch();
    };
    const skipFolder = () => {
        const f = queue[currentIndex]?.folder;
        if (!f) { setCurrentIndex(i => i + 1); return; }
        let i = currentIndex;
        while (i < queue.length && queue[i].folder === f) i++;
        const n = i - currentIndex;
        if (!window.confirm(`Skip the rest of "${f}"?\n\n${n} image(s) in this folder will be passed over without importing.`)) return;
        setNotes(''); setClientSku('');
        setCurrentIndex(i);
    };

    const inputStyle = { width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px', outline: 'none' };
    const labelStyle = { fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>

            {/* MODE TOGGLE: existing image conveyor vs program-print (PDF) uploader */}
            <div style={{ display: 'flex', border: `1px solid ${theme.line}`, alignSelf: 'flex-start', background: '#fff' }}>
                {[['images', 'Images'], ['prints', 'Program Prints (PDF)']].map(([m, label]) => (
                    <button key={m} onClick={() => setMode(m)} style={{ padding: '10px 22px', background: mode === m ? theme.ink : 'transparent', color: mode === m ? '#fff' : theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', cursor: 'pointer' }}>{label}</button>
                ))}
            </div>

            {mode === 'prints' ? (
                <ProgramPrintUploader currentUser={currentUser} activeBrand={activeBrand} />
            ) : (
            <>
            {/* Header Area */}
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Batch Asset Processor</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>CONVEYOR BELT IMAGE UPLOADER</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', fontWeight: 500, color: remaining > 0 ? theme.brass : theme.inkSoft }}>
                        {remaining} IMAGES REMAINING
                    </div>
                    {safeQueue.length > 0 && (
                        <button onClick={cancelBatch} disabled={isProcessing} title="Drop everything still waiting. Uploaded assets are unaffected."
                            style={{ padding: '10px 16px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: isProcessing ? 'not-allowed' : 'pointer' }}>
                            ✕ Cancel batch
                        </button>
                    )}
                    <label style={{ background: '#fff', color: theme.ink, padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${theme.ink}`, transition: 'background 0.2s' }}>
                        + SELECT FOLDER
                        <input type="file" multiple webkitdirectory="" onChange={handleFolderSelect} style={{ display: 'none' }} />
                    </label>
                    <label style={{ background: theme.ink, color: '#fff', padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                        + SELECT BATCH
                        <input type="file" multiple accept="image/png, image/jpeg" onChange={handleFileSelect} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            {/* PERMISSIONS, SAID OUT LOUD. Two failures used to be silent and both look identical
                to "your folder is named wrong": a login that cannot READ the Master Library sees
                every folder unresolved, and one that cannot WRITE it uploads perfectly and never
                gets a thumbnail. Neither is the operator's mistake and neither should be guessed at. */}
            {libraryError && (
                <div style={{ background: '#fdf3f3', border: '1px solid #d9534f', padding: '16px 22px' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.14em', textTransform: 'uppercase', color: '#d9534f', marginBottom: '6px' }}>Master Library could not be read</div>
                    <div style={{ fontFamily: theme.sans, fontSize: '0.92rem', color: theme.ink, lineHeight: 1.6 }}>
                        This login cannot read the Master Library, so no folder will resolve to an item and
                        every one will report “not in the Master Library” — that is this, not your folder names.
                        Images can still be uploaded to the Asset Gallery; they will not get a thumbnail.
                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '8px' }}>{libraryError} · ask Stuart to check this role's access</div>
                    </div>
                </div>
            )}
            {stampFails.length > 0 && (
                <div style={{ background: '#fdf8ee', border: `1px solid ${theme.brass}`, padding: '16px 22px' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.14em', textTransform: 'uppercase', color: theme.brass, marginBottom: '6px' }}>Uploaded — but the thumbnail was refused</div>
                    <div style={{ fontFamily: theme.sans, fontSize: '0.92rem', color: theme.ink, lineHeight: 1.6 }}>
                        {stampFails.length} image(s) reached the Asset Gallery, but this login was not allowed to
                        set the picture on the Master Library item. Nothing is lost — someone with library access
                        can run <b>4. Master Library → Sync Thumbnails</b> to finish it.
                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '8px' }}>
                            {stampFails.slice(0, 6).map(f => f.code).join(', ')}{stampFails.length > 6 ? ` +${stampFails.length - 6} more` : ''} · {stampFails[0].why}
                        </div>
                    </div>
                    <button onClick={() => setStampFails([])} style={{ marginTop: '10px', padding: '7px 14px', background: 'transparent', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', color: theme.inkSoft }}>Dismiss</button>
                </div>
            )}

            {safeQueue.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px dashed ${theme.brass}`, color: theme.inkSoft, fontFamily: theme.serif, fontSize: '1.4rem', padding: '60px 20px' }}>
                    <div>Drag & Drop or Select a Batch of Images to Begin</div>
                    <div style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.8 }}>SELECT FOLDER = Kermit renders (folder name is the plate code, finishes read from filenames)<br />or name a folder after the item — Bubley/01P23x23, Bubley:01P23x23 or Bubley_01P23x23 all import onto that item</div>
                </div>
            ) : isDone ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: theme.paper2, border: `1px solid ${theme.line}`, color: theme.ink }}>
                    <div style={{ fontSize: '3rem' }}>✅</div>
                    <h2 style={{ margin: '15px 0 10px 0', fontFamily: theme.serif, fontWeight: 500 }}>Batch Complete</h2>
                    <p style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft }}>Processed {safeQueue.length} images.</p>
                    <button onClick={resetBatch} style={{ marginTop: '20px', padding: '12px 24px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>START NEW BATCH</button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '20px', flex: 1 }}>

                    {/* Sidebar Queue */}
                    <div style={{ width: '250px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto', maxHeight: '75vh' }}>
                        <div style={{ padding: '15px', background: theme.paper, color: theme.ink, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textAlign: 'center', position: 'sticky', top: 0, zIndex: 10, borderBottom: `1px solid ${theme.line}` }}>UPCOMING PIPELINE</div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {visibleQueue.map((entry, localIdx) => {
                                const idx = currentIndex + localIdx;
                                const isCurrent = idx === currentIndex;
                                return (
                                    <div key={idx} style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', background: isCurrent ? theme.paper2 : '#fff', border: isCurrent ? `1px solid ${theme.brass}` : `1px solid ${theme.line}`, color: isCurrent ? theme.ink : theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {idx + 1}. {entry?.folder ? `[${entry.folder}] ` : ''}{String(entry?.file?.name || 'Unknown')}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Image Preview Window (with per-folder crop tool) */}
                    <div style={{ flex: 2, background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${theme.line}`, overflow: 'hidden', position: 'relative' }}>
                        {imagePreview && (
                            <div
                                ref={cropBoxRef}
                                onMouseDown={onCropDown} onMouseMove={onCropMove} onMouseUp={onCropUp} onMouseLeave={onCropUp}
                                style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%', cursor: cropMode ? 'crosshair' : 'default', lineHeight: 0 }}
                            >
                                <img src={imagePreview} alt="Preview" draggable={false} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', boxShadow: '0 4px 24px rgba(0,0,0,0.05)', display: 'block' }} />
                                {(dragRect || activeCrop) && (() => {
                                    const r = dragRect || activeCrop;
                                    return (
                                        <div style={{ position: 'absolute', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, border: `2px solid ${theme.brass}`, boxShadow: '0 0 0 9999px rgba(28,26,22,0.45)', pointerEvents: 'none' }} />
                                    );
                                })()}
                            </div>
                        )}

                        <div style={{ position: 'absolute', top: '15px', left: '15px', display: 'flex', gap: '8px', zIndex: 5 }}>
                            <button onClick={() => { setCropMode(m => !m); setDragRect(null); }} style={{ padding: '8px 14px', background: cropMode ? theme.brass : 'rgba(255,255,255,0.92)', color: cropMode ? '#fff' : theme.ink, border: `1px solid ${cropMode ? theme.brass : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.08em', cursor: 'pointer' }}>
                                {cropMode ? 'DRAG TO SET CROP…' : (activeCrop ? '✂ ADJUST CROP' : '✂ SET CROP')}
                            </button>
                            {activeCrop && !cropMode && (
                                <button onClick={() => setFolderField({ crop: null })} style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.92)', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.08em', cursor: 'pointer' }}>
                                    ✕ CLEAR
                                </button>
                            )}
                            {activeCrop && (
                                <span style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.92)', border: `1px solid ${theme.line}`, color: theme.brass, fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.08em' }}>
                                    CROP APPLIES TO {folderKey === '~loose~' ? 'LOOSE FILES' : `FOLDER ${folderKey}`}
                                </span>
                            )}
                        </div>

                        <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'rgba(255,255,255,0.9)', border: `1px solid ${theme.line}`, color: theme.ink, padding: '6px 12px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em' }}>
                            {queue[currentIndex]?.folder ? `${queue[currentIndex].folder} / ` : ''}{String(queue[currentIndex]?.file?.name || "Unknown")}
                        </div>
                    </div>

                    {/* Metadata Form Panel */}
                    <div style={{ flex: 1.2, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto', maxHeight: '75vh' }}>
                        <div style={{ fontFamily: theme.serif, fontSize: '1.4rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: `10px` }}>Metadata Injection</div>

                        {/* SOFT-GOODS BANNER — says what the folder was read as and whether the
                            Master Library actually has that item. A folder is filing, not a key, so
                            the resolution is shown rather than assumed. */}
                        {(() => {
                            const soft = softGoodsOf(queue[currentIndex]);
                            if (!soft) return null;
                            const ok = !!soft.hit;
                            return (
                                <div style={{ border: `1px solid ${ok ? theme.brass : '#d9534f'}`, background: ok ? theme.paper : '#fdf3f3', padding: '14px 16px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.14em', textTransform: 'uppercase', color: ok ? theme.brass : '#d9534f', marginBottom: '6px' }}>
                                        {ok ? 'Soft goods — folder resolved' : 'Soft goods — folder NOT resolved'}
                                    </div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.ink }}>
                                        {soft.parsed.pattern || '—'} · colour {soft.parsed.color || '—'} · {soft.parsed.kind === 'T' ? `throw${soft.parsed.isXL ? ' XL' : ''}` : (soft.parsed.size || '—')}
                                    </div>
                                    <div style={{ fontFamily: theme.mono, fontSize: '12px', marginTop: '5px', color: ok ? '#3a7d44' : '#d9534f' }}>
                                        {ok
                                            ? `✓ ${soft.libCode}${soft.from === 'filename' ? '  (read from the file name)' : ''}${soft.matchedBy === 'parts' ? '  (matched on pattern + colour + size)' : ''}`
                                            : `✗ ${soft.libCode || 'could not build a code'} — ${(soft.parsed.why || []).join(' · ') || 'not in the Master Library'}`}
                                    </div>
                                    {!ok && <div style={{ fontFamily: theme.mono, fontSize: '10px', marginTop: '6px', color: theme.inkSoft, lineHeight: 1.6 }}>
                                        {libraryError
                                            ? 'The Master Library could not be read on this login — see the banner above. This is NOT your folder name.'
                                            : (safeHqParts.length === 0
                                                ? 'The Master Library has not loaded yet — give it a moment and this will re-check itself.'
                                                : 'Type our item # below to import anyway — nothing is written against a code the library does not have.')}
                                    </div>}
                                </div>
                            );
                        })()}

                        {/* WHICH PICTURE BECOMES THE ITEM'S. Every image in the folder goes to the
                            gallery; exactly one becomes the Master Library thumbnail. Defaults to the
                            first of each folder. A real photograph always outranks a .glb render, so
                            ticking this replaces a stand-in but never another photograph. */}
                        <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', border: `1px solid ${useAsThumb ? theme.brass : theme.line}`, background: useAsThumb ? theme.paper : '#fff', padding: '12px 14px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={useAsThumb} onChange={e => setUseAsThumb(e.target.checked)} style={{ marginTop: '3px' }} />
                            <span>
                                <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.ink }}>★ Master Library thumbnail</span>
                                <span style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginTop: '4px', lineHeight: 1.6 }}>
                                    {useAsThumb ? 'This image becomes the item picture. The rest of the folder still goes to the gallery.' : 'Gallery only — the item keeps whichever picture it has.'}
                                </span>
                            </span>
                        </label>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>PATTERN / PLATE ID</label>
                                <input
                                    ref={idInputRef}
                                    type="text"
                                    value={patternId}
                                    onChange={e => setPatternId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. H1-1BP-R"
                                    style={inputStyle}
                                />
                                {resolved ? (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, marginTop: '5px', letterSpacing: '.05em' }}>
                                        ✓ {String(resolved.doc.itemName || resolved.base)}{resolved.summary ? ` — ${resolved.summary}` : ''}
                                    </div>
                                ) : patternId ? (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginTop: '5px', letterSpacing: '.05em' }}>— no exact Master Library match</div>
                                ) : null}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>FINISH ID</label>
                                <input
                                    type="text"
                                    value={finishId}
                                    onChange={e => setFinishId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. EP1"
                                    style={inputStyle}
                                />
                                {/^EP0+\d+$/.test(String(finishId).toUpperCase().trim()) && (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, marginTop: '5px', letterSpacing: '.05em' }}>↳ EP leading zero auto-removed → {String(finishId).toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1')}</div>
                                )}
                            </div>
                        </div>

                        {/* THE COMBO: fee item (french/miter return) or bracket arm shown WITH the plate */}
                        <div style={{ border: `1px solid ${pairedDoc ? theme.brass : theme.line}`, background: theme.paper, padding: '12px' }}>
                            <label style={labelStyle}>SECOND ITEM SHOWN (HARDWARE COMBO — OPTIONAL)</label>
                            {pairedDoc ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                                    <span style={{ background: '#fff', border: `1px solid ${theme.brass}`, color: theme.ink, padding: '6px 10px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em' }}>
                                        {pairedInfo?.endTreatment ? `${END_TREATMENT_LABELS[pairedInfo.endTreatment]} · ` : ''}{pairedInfo?.code} — {String(pairedDoc.itemName || '')}
                                        <span onClick={() => setFolderField({ pairedDocId: null })} style={{ cursor: 'pointer', marginLeft: '8px', color: theme.inkSoft }}>×</span>
                                    </span>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="text"
                                        value={pairedQuery}
                                        onChange={e => setPairedQuery(e.target.value)}
                                        placeholder="Search fee items / bracket arms…"
                                        style={{ ...inputStyle, marginTop: '8px' }}
                                    />
                                    <div style={{ maxHeight: '150px', overflowY: 'auto', marginTop: '5px', display: 'flex', flexDirection: 'column' }}>
                                        {pairedSuggestions.map(p => {
                                            const info = pairedInfoOf(p);
                                            return (
                                                <button key={p.id} onClick={() => { setFolderField({ pairedDocId: p.id, pairedChosen: true }); setPairedQuery(''); }} style={{ textAlign: 'left', padding: '7px 8px', background: '#fff', border: 'none', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.ink, cursor: 'pointer' }}>
                                                    {info?.endTreatment ? `[${END_TREATMENT_LABELS[info.endTreatment]}] ` : info?.role === 'ARM' ? '[ARM] ' : ''}{partCodeOf(p)} — {String(p.itemName || '')}
                                                </button>
                                            );
                                        })}
                                        {pairedSuggestions.length === 0 && (
                                            <div style={{ padding: '7px 8px', fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft }}>Type to search the Master Library…</div>
                                        )}
                                    </div>
                                </>
                            )}
                            <div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.inkSoft, marginTop: '6px', letterSpacing: '.05em' }}>STICKY PER FOLDER — set once on the first image; the rest of the folder inherits it.</div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>FABRICUT CODE {queue[currentIndex]?.folder ? '(STICKY PER FOLDER)' : ''}</label>
                                <input type="text" value={fabCode} onChange={e => { const v = e.target.value; setFabCode(v); if (queue[currentIndex]?.folder) setFolderField({ fabCode: v.trim().toUpperCase() }); }} onKeyDown={handleKeyDown} placeholder="e.g. HNFSRFRSB079" style={inputStyle} />
                                {fabCodeStatus && (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: fabCodeStatus.ok ? theme.brass : '#a33', marginTop: '5px', letterSpacing: '.05em' }}>{fabCodeStatus.txt}</div>
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>FABRICUT COLOR NAME</label>
                                <input type="text" value={fabColorName} onChange={e => setFabColorName(e.target.value)} onKeyDown={handleKeyDown} placeholder="e.g. STAIN NICKEL" style={inputStyle} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>CUSTOMER (CRM)</label>
                                <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ ...inputStyle, textTransform: 'none' }}>
                                    <option value="">Select...</option>
                                    {customerOptions.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>CLIENT SKU / PART #</label>
                                <input
                                    type="text"
                                    value={clientSku}
                                    onChange={e => setClientSku(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. CUST-999"
                                    style={inputStyle}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>COLLECTION</label>
                                <select value={collectionName} onChange={e => setCollectionName(e.target.value)} style={{ ...inputStyle, textTransform: 'none' }}>
                                    <option value="">Select...</option>
                                    {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>PRODUCT TYPE</label>
                                <select value={productType} onChange={e => setProductType(e.target.value)} style={{ ...inputStyle, textTransform: 'none' }}>
                                    <option value="">Select...</option>
                                    {globalLists.prodTypes.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        <label title="Stamps portalCollections + portalVisible on every import — the same flag the gallery's bulk 🌐 button writes, so no re-tag pass is needed. Only customers entitled to the selected collection (CRM → Portal Access → Available Collections) see the image." style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.06em', color: portalEnable ? theme.brass : theme.inkSoft, border: `1px dashed ${portalEnable ? theme.brass : theme.line}`, padding: '9px 12px' }}>
                            <input type="checkbox" checked={portalEnable} onChange={e => setPortalEnable(e.target.checked)} />
                            🌐 MAKE AVAILABLE IN CUSTOMER PORTAL{portalEnable ? ` — UNDER ${String(collectionName || '').trim().toUpperCase() || '⚠ PICK A COLLECTION'}` : ''}
                        </label>

                        <div>
                            <label style={labelStyle}>SEARCHABLE OPEN NOTES</label>
                            <textarea
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Any keywords you want to search by later..."
                                style={{ ...inputStyle, textTransform: 'none', minHeight: '60px', resize: 'vertical' }}
                            />
                        </div>

                        {/* PART TAGGING */}
                        <select
                            onChange={(e) => {
                                if (e.target.value && !associatedParts.includes(e.target.value)) {
                                    setAssociatedParts(prev => [...prev, e.target.value]);
                                }
                            }}
                            style={{ padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                        >
                            <option value="">+ Link to Master Library Part...</option>
                            {safeHqParts.slice(0, 200).map(p => <option key={p.id} value={p.id}>{String(p.itemName || p.id)}</option>)}
                        </select>
                        {associatedParts.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {associatedParts.map(partId => (
                                    <span key={partId} style={{ background: theme.paper2, color: theme.ink, border: `1px solid ${theme.line}`, padding: '4px 8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {String(safeHqParts.find(p => p.id === partId)?.itemName || partId)}
                                        <span onClick={() => setAssociatedParts(prev => prev.filter(id => id !== partId))} style={{ cursor: 'pointer', color: theme.inkSoft }}>×</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* FINISHES ASSIGNMENT */}
                        <select
                            onChange={(e) => {
                                if (e.target.value && !associatedFinishes.includes(e.target.value)) {
                                    setAssociatedFinishes(prev => [...prev, e.target.value]);
                                }
                            }}
                            style={{ padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                        >
                            <option value="">+ Link to Master Finish...</option>
                            <optgroup label="In-House & Global Finishes">
                                {allFinishes.map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
                            </optgroup>
                            <optgroup label="Outsourced Finishes">
                                {(Array.isArray(outsourceFinishes)?outsourceFinishes:[]).map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
                            </optgroup>
                        </select>

                        {associatedFinishes.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {associatedFinishes.map(finId => (
                                    <span key={finId} style={{ background: theme.paper2, color: theme.ink, border: `1px solid ${theme.line}`, padding: '4px 8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {String([...allFinishes, ...(Array.isArray(outsourceFinishes)?outsourceFinishes:[])].find(f => f.id === finId)?.name || finId)}
                                        <span onClick={() => setAssociatedFinishes(prev => prev.filter(id => id !== finId))} style={{ cursor: 'pointer', color: theme.inkSoft }}>×</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textAlign: 'center', letterSpacing: '.1em', textTransform: 'uppercase' }}>Tip: Press Enter to submit instantly</div>
                            <button
                                onClick={handleProcessAndNext}
                                disabled={isProcessing || !patternId}
                                style={{
                                    padding: '15px',
                                    background: (isProcessing || !patternId) ? theme.paper2 : theme.ink,
                                    color: (isProcessing || !patternId) ? theme.inkSoft : '#fff',
                                    fontFamily: theme.mono,
                                    fontSize: '11px',
                                    letterSpacing: '.18em',
                                    textTransform: 'uppercase',
                                    border: (isProcessing || !patternId) ? `1px solid ${theme.line}` : 'none',
                                    cursor: (isProcessing || !patternId) ? 'not-allowed' : 'pointer',
                                    transition: 'background 0.2s'
                                }}
                                onMouseOver={(e) => { if(!isProcessing && patternId) e.currentTarget.style.background = theme.brass; }}
                                onMouseOut={(e) => { if(!isProcessing && patternId) e.currentTarget.style.background = theme.ink; }}
                            >
                                {isProcessing && !autoRun ? "GENERATING & UPLOADING..." : "PROCESS & NEXT"}
                            </button>
                            {remainingInFolder.length > 0 && (
                                <button
                                    onClick={handleProcessFolder}
                                    disabled={isProcessing || !patternId}
                                    style={{ padding: '13px', background: (isProcessing || !patternId) ? theme.paper2 : theme.brass, color: (isProcessing || !patternId) ? theme.inkSoft : '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.14em', textTransform: 'uppercase', border: 'none', cursor: (isProcessing || !patternId) ? 'not-allowed' : 'pointer' }}
                                >
                                    {autoRun ? `PROCESSING FOLDER… ${autoRun.done}/${autoRun.total}` : `⚡ PROCESS WHOLE FOLDER (${remainingInFolder.length + 1}) — finishes from filenames`}
                                </button>
                            )}
                            <button onClick={() => { setNotes(""); setClientSku(""); setCurrentIndex(prev => prev + 1); }} disabled={isProcessing} style={{ padding: '10px', background: 'transparent', color: theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textDecoration: 'underline', cursor: 'pointer' }}>
                                SKIP THIS IMAGE
                            </button>
                            {queue[currentIndex]?.folder && (
                                <button onClick={skipFolder} disabled={isProcessing} style={{ padding: '10px', background: 'transparent', color: theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textDecoration: 'underline', cursor: 'pointer' }}>
                                    SKIP REST OF THIS FOLDER
                                </button>
                            )}
                        </div>

                    </div>
                </div>
            )}
            </>
            )}

            {/* FOLDER PAIRING PROMPT — first question for every new folder: the plate is the
                folder name; which bracket arm / fee item is it combined with in these images? */}
            {pairPrompt && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ background: '#fff', width: '90%', maxWidth: '950px', display: 'flex', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                        <div style={{ flex: 1, background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', minHeight: '420px' }}>
                            {imagePreview ? <img src={imagePreview} alt="folder sample" style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain' }} /> : <span style={{ color: theme.inkSoft }}>⚲</span>}
                        </div>
                        <div style={{ flex: 1, padding: '30px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>What is in these images?</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink, letterSpacing: '.05em' }}>
                                FOLDER: <span style={{ color: theme.brass }}>{pairPrompt.folder}</span>
                            </div>
                            {resolved && (
                                <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, letterSpacing: '.05em' }}>
                                    ✓ {String(resolved.doc.itemName || resolved.base)}{resolved.summary ? ` — ${resolved.summary}` : ''}
                                </div>
                            )}
                            {/* Generalised 2026-08-27 (Stuart: "add in something about general images
                                not just brackets"). This screen takes product photography of every
                                kind now — pillows, throws, lifestyle shots — and the old wording asked
                                a hardware question of all of them, which reads as though the tool does
                                not know what it is looking at. The pairing is still only meaningful for
                                a hardware combo, so it is offered rather than demanded. */}
                            <div style={{ fontFamily: theme.sans, fontSize: '0.9rem', color: theme.inkSoft, lineHeight: 1.6 }}>
                                If these are <b>hardware combo</b> shots, name the second item shown with it —
                                a <b>bracket arm</b>, or a <b>fee item</b> (french/miter return). Applies to the whole folder.
                                <div style={{ marginTop: '8px' }}>
                                    Anything else — a single item, a pillow or throw, a lifestyle or detail
                                    shot — needs no pairing. Take the option below and the images import
                                    against this folder's item on its own.
                                </div>
                            </div>
                            <input
                                autoFocus
                                type="text"
                                value={pairPromptQuery}
                                onChange={e => setPairPromptQuery(e.target.value)}
                                placeholder="e.g. CE-FEE-4594 or H1-DE…"
                                style={{ width: '100%', padding: '12px', border: `1px solid ${theme.brass}`, fontFamily: theme.sans, fontSize: '0.95rem', textTransform: 'uppercase', boxSizing: 'border-box', outline: 'none' }}
                            />
                            <div style={{ flex: 1, minHeight: '140px', maxHeight: '220px', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                                {pairPromptSuggestions.map(p => {
                                    const info = pairedInfoOf(p);
                                    return (
                                        <button key={p.id} onClick={() => { setFolderMeta(prev => ({ ...prev, [pairPrompt.folder]: { ...(prev[pairPrompt.folder] || {}), pairedDocId: p.id, pairedChosen: true } })); setPairPrompt(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', background: '#fff', border: 'none', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.ink, cursor: 'pointer' }}>
                                            {info?.endTreatment ? `[${END_TREATMENT_LABELS[info.endTreatment]}] ` : info?.role === 'ARM' ? '[ARM] ' : ''}{partCodeOf(p)} — {String(p.itemName || '')}
                                        </button>
                                    );
                                })}
                                {pairPromptSuggestions.length === 0 && (
                                    <div style={{ padding: '10px', fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft }}>No matches — type our item # or a name (fees, arms and inside mounts at this diameter show first).</div>
                                )}
                            </div>
                            <button onClick={() => { setFolderMeta(prev => ({ ...prev, [pairPrompt.folder]: { ...(prev[pairPrompt.folder] || {}), pairedDocId: null, pairedChosen: true } })); setPairPrompt(null); }} style={{ padding: '10px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>
                                NO SECOND ITEM — SINGLE PRODUCT, PILLOW OR LIFESTYLE SHOT
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* FIX-IT-NOW POPUP — the folder run pauses here; nothing saves until resolved */}
            {fixModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ background: '#fff', width: '90%', maxWidth: '900px', display: 'flex', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                        <div style={{ flex: 1, background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', minHeight: '380px' }}>
                            {fixModal.previewUrl ? <img src={fixModal.previewUrl} alt="needs info" style={{ maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain' }} /> : <span style={{ color: theme.inkSoft }}>⚲</span>}
                        </div>
                        <div style={{ flex: 1, padding: '30px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div style={{ fontFamily: theme.serif, fontSize: '1.4rem', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>Missing Information</div>
                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.05em', wordBreak: 'break-all' }}>
                                {fixModal.folder ? `${fixModal.folder} / ` : ''}{String(fixModal.file?.name || '')}
                            </div>
                            {(fixModal.reasons || []).map(r => (
                                <div key={r} style={{ fontFamily: theme.mono, fontSize: '10px', color: '#a33', letterSpacing: '.04em' }}>⚠ {r}</div>
                            ))}
                            <div>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft }}>FINISH ID *</label>
                                <input type="text" value={fixModal.values.finishId} onChange={e => setFixModal(fm => ({ ...fm, values: { ...fm.values, finishId: e.target.value.toUpperCase() } }))} placeholder="e.g. P07 / EP3" style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, textTransform: 'uppercase', boxSizing: 'border-box', marginTop: '4px', outline: 'none' }} />
                            </div>
                            <div>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft }}>FABRICUT CODE *</label>
                                <input type="text" value={fixModal.values.fabCode} onChange={e => setFixModal(fm => ({ ...fm, values: { ...fm.values, fabCode: e.target.value.toUpperCase() } }))} placeholder="from the CrossReference" style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, textTransform: 'uppercase', boxSizing: 'border-box', marginTop: '4px', outline: 'none' }} />
                            </div>
                            <div>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft }}>FABRICUT COLOR NAME</label>
                                <input type="text" value={fixModal.values.fabColorName} onChange={e => setFixModal(fm => ({ ...fm, values: { ...fm.values, fabColorName: e.target.value.toUpperCase() } }))} placeholder="e.g. STAIN NICKEL" style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, textTransform: 'uppercase', boxSizing: 'border-box', marginTop: '4px', outline: 'none' }} />
                            </div>
                            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    disabled={!fixModal.values.finishId || !fixModal.values.fabCode}
                                    onClick={() => closeFix({ action: 'save', values: fixModal.values })}
                                    style={{ padding: '13px', background: (!fixModal.values.finishId || !fixModal.values.fabCode) ? theme.paper2 : theme.ink, color: (!fixModal.values.finishId || !fixModal.values.fabCode) ? theme.inkSoft : '#fff', border: 'none', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.14em', cursor: (!fixModal.values.finishId || !fixModal.values.fabCode) ? 'not-allowed' : 'pointer' }}
                                >
                                    SAVE & CONTINUE FOLDER
                                </button>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => closeFix({ action: 'skip' })} style={{ flex: 1, padding: '10px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>SKIP IMAGE (don't import)</button>
                                    <button onClick={() => closeFix({ action: 'stop' })} style={{ flex: 1, padding: '10px', background: 'transparent', color: '#a33', border: '1px solid #a33', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>STOP FOLDER RUN</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchImageProcessor;
