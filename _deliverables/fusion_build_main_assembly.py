# fusion_build_main_assembly.py  —  Autodesk Fusion 360 script (Python)
# ---------------------------------------------------------------------------
# Builds the CPQ "MAIN ASSEMBLY" for ONE diameter family (H1-75 / H1-1 / H1-138)
# by placing every variant part at its CPQ position, each occurrence NAMED WITH
# THE PART CODE so the web app's Auto-Group + Auto-Assign-by-name light up
# automatically downstream.  Run it from the family's individual part assemblies.
#
# WHY NAMING MATTERS: the web app reads the .glb's top-level component names.
#   - Auto-Group turns each top-level component into a cluster, labelled by
#     geometry as LEFT / CENTER / RIGHT.
#   - Auto-Assign BOM then matches each cluster to the library part whose
#     legacyErpId == the code (e.g. "H1-75BR").  So the occurrence name MUST be
#     the base code (NO /color suffix).
#
# === DESIGNER / CLAUDE CODE FILLS IN (search >>> EDIT) ============================
#   1. PARTS    : code -> where the part lives (a component in THIS design, or an
#                 external .f3d file) + which positions it occupies.
#   2. LAYOUT   : pole length, the L/C/R bracket X positions, the end offsets.
#   3. EXPORT   : per your Fusion glTF / Blender settings (see brief Part 3).
# Fusion internal length unit is CENTIMETRES, so we convert inches -> cm.
# ---------------------------------------------------------------------------
import adsk.core, adsk.fusion, traceback

IN = 2.54  # inches -> cm (Fusion internal units)

# >>> EDIT 2 — LAYOUT for this family (inches) -------------------------------
POLE_AXIS = 'x'                                   # the rod runs along this axis
LCR_POS_IN = {'LEFT': -42.0, 'CENTER': 0.0, 'RIGHT': 42.0}   # bracket positions
END_POS_IN = {'LEFT': -48.0, 'RIGHT': 48.0}                  # finial / end-cap positions
# All variants that share a position OVERLAP there (that's the Choose/Swap set);
# the CPQ flow's Hide-Geometry + geometry-swap pick which one shows.

# >>> EDIT 1 — PARTS: fill from H1-75_Collection_Review.xlsx -----------------
#   source : ('component', '<name of a component already in THIS design>')
#         or ('file',      '/abs/path/to/Part.f3d')        # external Fusion archive
#   positions: subset of LEFT/CENTER/RIGHT (brackets/plates) or LEFT/RIGHT (ends)
#   axis : 'LCR' (uses LCR_POS_IN) or 'END' (uses END_POS_IN)
PARTS = {
    # ---- 6 WALL BRACKETS (L/C/R) ----
    # 'H1-75BR':  dict(source=('file', '.../Basic Bracket 3-5_8.f3d'),       positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75BE':  dict(source=('file', '.../Basic Bracket 4-5_8.f3d'),       positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75DS':  dict(source=('file', '.../Decorative Arm.f3d'),            positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75DE':  dict(source=('file', '.../Decorative Extended.f3d'),       positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75D':   dict(source=('file', '.../Double Bracket.f3d'),            positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75BD':  dict(source=('file', '.../Basic Double Bracket.f3d'),      positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # ---- CEILING (1) + INSIDE MOUNT (1) ----
    # 'H1-75CB':  dict(source=('file', '.../Ceiling Bracket.f3d'),           positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # 'H1-75IM':  dict(source=('file', '.../Inside Mount.f3d'),              positions=['LEFT','RIGHT'],          axis='END'),
    # ---- 4 BACKPLATES + 4 COVER PLATES (paired with brackets, L/C/R) ----
    # 'H1-75BP-H': dict(source=('file', '.../Backplate H.f3d'),             positions=['LEFT','CENTER','RIGHT'], axis='LCR'),
    # ... BP-R / BP-S / BP-V, CP-H/R/S/V, and the RBP / RCP "for Returns" twins ...
    # ---- ENDS: finials + end caps (L/R) ----
    # 'H1-75BF':  dict(source=('file', '.../Ball Finial.f3d'),              positions=['LEFT','RIGHT'], axis='END'),
    # 'H1-75GF':  dict(source=('file', '.../Gem Finial.f3d'),               positions=['LEFT','RIGHT'], axis='END'),
    # 'H1-75KF':  dict(source=('file', '.../Knob Finial.f3d'),              positions=['LEFT','RIGHT'], axis='END'),
    # 'H1-75EC':  dict(source=('file', '.../End Cap.f3d'),                  positions=['LEFT','RIGHT'], axis='END'),
    # ---- POLE + RING (shared) ----
    # 'H1-75ROD': dict(source=('file', '.../Rod 3-4in.f3d'),                positions=['CENTER'], axis='LCR'),
    # 'H1-75PS':  dict(source=('file', '.../Passing Ring.f3d'),             positions=['CENTER'], axis='LCR'),
}
# ---------------------------------------------------------------------------


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get(); ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Open a Fusion DESIGN as the active document first.'); return
        root = design.rootComponent
        imp = design.importManager

        def vec(x_in):
            v = [0.0, 0.0, 0.0]; v['xyz'.index(POLE_AXIS)] = x_in * IN
            return adsk.core.Vector3D.create(*v)

        def resolve(source):
            kind, ref = source
            if kind == 'component':
                for c in design.allComponents:
                    if c.name == ref: return c
                raise RuntimeError('component not found in design: ' + ref)
            if kind == 'file':
                before = root.occurrences.count
                opts = imp.createFusionArchiveImportOptions(ref)
                imp.importToTarget(opts, root)
                return root.occurrences.item(root.occurrences.count - 1).component
            raise RuntimeError('bad source: ' + str(source))

        placed = 0
        for code, spec in PARTS.items():
            comp = resolve(spec['source'])
            pos_map = LCR_POS_IN if spec.get('axis', 'LCR') == 'LCR' else END_POS_IN
            for label in spec['positions']:
                m = adsk.core.Matrix3D.create()
                m.translation = vec(pos_map[label])
                occ = root.occurrences.addExistingComponent(comp, m)
                # single-position parts keep the bare code; repeats keep code + position
                occ.component.name = code if len(spec['positions']) == 1 else '{} {}'.format(code, label)
                placed += 1

        ui.messageBox('Built MAIN ASSEMBLY: {} occurrences placed.\n'
                      'Review positions, then export per your glTF/Blender settings '
                      '(see brief Part 3).'.format(placed))
    except:
        if ui: ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
