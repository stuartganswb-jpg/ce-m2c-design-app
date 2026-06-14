# blender_process_glb.py  —  headless Blender cleanup + .glb export
# ---------------------------------------------------------------------------
# Takes the intermediate file Fusion produced (FBX / OBJ / glTF / STEP-via-addon)
# and emits a web-ready .glb that the app's renderer + Auto-Group expect:
#   - hierarchy + component NAMES preserved (so Auto-Group / Auto-Assign work)
#   - materials forced OPAQUE (avoids the "ring renders behind the pole" bug;
#     the app also force-opaques as a backstop, but do it at the source)
#   - binary GLB, +Y up
#
# RUN (Mac):
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#       --python blender_process_glb.py -- INPUT.fbx OUTPUT.glb
# ---------------------------------------------------------------------------
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    print('usage: ... -- INPUT OUTPUT.glb'); sys.exit(1)
src, out = argv[0], argv[1]

# fresh empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# import — adjust to the intermediate format you export from Fusion (>>> EDIT if needed)
low = src.lower()
if low.endswith('.fbx'):           bpy.ops.import_scene.fbx(filepath=src)
elif low.endswith('.obj'):         bpy.ops.wm.obj_import(filepath=src)
elif low.endswith(('.gltf', '.glb')): bpy.ops.import_scene.gltf(filepath=src)
else:
    print('Unsupported input: ' + src + '  (add an importer for your format)'); sys.exit(1)

# force every material opaque
for m in bpy.data.materials:
    try: m.blend_method = 'OPAQUE'
    except Exception: pass
    if getattr(m, 'use_nodes', False):
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED' and 'Alpha' in n.inputs:
                n.inputs['Alpha'].default_value = 1.0

# (optional) decimate heavy meshes here if file size is large — left off by default

# export web-ready GLB, preserving hierarchy + names
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_yup=True,
    use_visible=False,        # include everything; the CPQ flow hides per-config
    export_apply=False,       # keep the transforms/hierarchy
)
print('wrote ' + out + '  (' + str(os.path.getsize(out) // 1024) + ' KB)')
