"""Blender batch decimator. Run only when Settings allow Blender.
blender --background --python decimate.py -- in.fbx out.fbx 6000
Prints faces before and after, joins meshes, applies transforms, writes an FBX.
"""
import sys

import bpy  # only available inside Blender


def main(argv):
    if len(argv) < 3:
        print("usage: -- in.fbx out.fbx target_triangles")
        return 2
    src, dst, target = argv[0], argv[1], int(argv[2])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=src)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("no meshes in", src)
        return 1
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    def tris(o):
        o.data.calc_loop_triangles()
        return len(o.data.loop_triangles)

    before = tris(obj)
    if before > target:
        mod = obj.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.001, target / before)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    after = tris(obj)
    print(f"REPORT triangles before={before} after={after} target={target}")
    if after > 20000:
        print("WARNING over the 20000 Roblox per-mesh limit")
    bpy.ops.export_scene.fbx(filepath=dst, use_selection=True, apply_unit_scale=True)
    return 0


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sys.exit(main(args))
