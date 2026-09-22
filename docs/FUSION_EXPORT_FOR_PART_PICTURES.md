# Exporting so every part gets its own picture

**For the designer. One rule, and the reason behind it.**

*Written 2026-09-22, after the H1-2TRV brackets arrived as single meshes and no tool could get a
picture of the backplate, the arm or the L-arm inside them.*

---

## The rule

> **Anything that needs its own picture must be a TOP-LEVEL component in the exported file.**
>
> Not a body inside a bracket. Not a sub-component nested under an assembly. A direct child of the
> file's root.

Everything below a top-level component is **welded into one mesh** on import. That is not a bug and
it is not going to change — it is what keeps the models small and fast enough to spin in the
configurator. But it does mean the export decides, permanently, what the app can ever photograph
or tag separately.

## Why — what the import actually does

`Shared/fusionImport.js` walks the FBX and, for every mesh, finds the **top-level node it sits
under** (`topOf`, line 78):

```js
const topOf = (o) => { let p = o; while (p.parent && p.parent !== root) p = p.parent; return p; };
```

Everything sharing a top-level node is collected as ONE component, and on export those bodies are
merged into a single mesh (`mergeGeometries`, then a vertex weld, line 148):

```js
let merged = uniform.length === 1 ? uniform[0] : mergeGeometries(uniform, false);
```

So the exported GLB holds **one mesh per top-level component**, carrying that component's name.

### What that produced for H1-2TRV

The bracket was one top-level component, so it became one mesh:

```
🧊 …__2_H12TRVBDBLRIGHT      ← the whole assembled bracket, one solid
```

The backplate (`H1-2TRVBP`), the L arm (`H1-2TRVLA`) and the arm (`H1-2TRVBADBL`) are inside it,
welded. Nothing in the app can reach them: the renderer photographs a *node*, and there is no node.
We had to cut their pictures out of a dimensioned PDF drawing by hand instead.

### What we want instead

```
🧊 H1-2TRVBP        ← top-level
🧊 H1-2TRVLA        ← top-level
🧊 H1-2TRVBADBL     ← top-level
```

Three components, three meshes, three pictures — generated automatically, for ever, with no
drawings and no manual work.

## Name them with the item code

The import auto-matches component names to library codes, so a component named `H1-2TRVBP` lands on
the right record by itself. Version noise is handled (`H1-75BE v3:2` and `H1-75BE_v32` both reduce
to `H1-75BE`), so you do not need to fight Fusion's naming.

What does NOT work: `Body1`, `Component7`, `Mirror of Bracket`. Those import fine and render fine —
they just can't be matched to an item, so somebody has to map them by hand, once per export, for
ever.

## What you get for the extra effort

Per-part geometry is not only about thumbnails. It is also:

- **BOM tagging at piece level in 1.6** — today a bracket can only be tagged as one thing
- **A picture on every line** of the quote, the pick list and the shop paperwork
- **Spec-sheet measurements** of individual parts
- **No re-drawing** when a part changes: re-export and every picture refreshes itself

## The short version

| | |
|---|---|
| **Do** | Make each sellable/pickable part a top-level component |
| **Do** | Name it with its item code (`H1-2TRVBP`) |
| **Don't** | Nest parts inside an assembly component and expect them to survive |
| **Don't** | Rely on body names — only the **top-level component** name reaches the app |

If a part genuinely is one welded piece in real life, then one mesh is correct and a drawing is the
right source for its picture. The rule is about parts that are separate in reality and only look
welded because of how the file was built.
