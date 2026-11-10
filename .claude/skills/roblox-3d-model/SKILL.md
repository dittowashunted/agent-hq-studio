---
name: roblox-3d-model
description: Use when a prop, hero object or background piece must become a shippable Roblox MeshPart, especially from a raw AI or scanned mesh with hundreds of thousands of faces. Covers source order, triangle and texture budgets, scale, pivot, decimation, UVs, SurfaceAppearance, collision and render fidelity, and the final check list.
---

# roblox-3d-model: from reference sheet to a shippable MeshPart

Goal: a mesh that looks right at play distance, costs little, and imports clean. A raw AI mesh can be around 600K faces; a shippable prop is usually a few thousand triangles.

## Source order (stop at the first that works)
1. Catalog or an existing asset pack (check Librarian's asset list and `roblox-storage-preflight` first; do not rebuild what exists).
2. Claude Design / the image lane for the reference sheet (`APP/model-refs.mjs` flow), then a generator the owner already uses.
3. Blender, only when Settings `blenderFallback` is on. If it is off, ask the owner; never install anything.

## Budgets (checked against the Creator docs: `art/modeling/specifications.md`, `texture-specifications.md`)
- Hard limit: one mesh cannot exceed 20,000 triangles. Parts you union or solid-model are simplified to the same cap.
- Working budgets (our choice, not a Roblox rule): hero object 6,000 to 12,000 tris; prop 500 to 3,000; background or far piece 100 to 800.
- Textures: Roblox accepts up to 4096 in some places, but PBR maps (SurfaceAppearance) are limited to 1024x1024. Size by footprint: 256 for about 5 studs, 512 for about 10, 1024 for 20 and up. Power of two. Formats png, jpg, tga, bmp.
- Fewer unique materials and meshes beat fewer triangles: repeat a mesh instead of making variants.

## Steps
1. Scale in studs. Decide the real size first (a door is about 7 studs tall; a character is about 5). Export at that size or scale on import. Freeze transforms: scale 1,1,1 and rotation 0,0,0.
2. Pivot: put the origin where it will be placed (base centre for props on the ground).
3. Reduce. Preferred order: remove hidden faces and interiors, then decimate (Collapse, ratio from the budget), then hand-fix the silhouette. Retopologise only for hero pieces or anything that bends. Run `decimate.py` for a repeatable batch pass and read its before/after report.
4. UVs: one non-overlapping UV set, margins of 4 to 8 px, texel density the same across the object. Bake detail from the high mesh into normal and ambient occlusion maps instead of keeping geometry.
5. Materials: import with SurfaceAppearance (ColorMap, NormalMap, MetalnessMap, RoughnessMap). Keep one material per mesh. Textures come from `roblox-texture-gen`, never drawn with code.
6. Fidelity: `CollisionFidelity` Box for small or decorative, Hull for convex objects, Default for simple concave, PreciseConvexDecomposition only when players must touch inner shape (it is the most expensive). Set `CanCollide`, `CanQuery`, `CanTouch` false on decoration. `RenderFidelity` Automatic by default (full detail under 250 studs, medium 250 to 500, lowest past 500); use Performance only when the mesh is tiny.
7. Name: `Category_Object_Variant` (for example `Prop_Crate_Wood`), anchored, in a named Folder.
8. LOD thinking: if the object is seen from far and near, check Automatic is enough; otherwise make a second cheaper mesh and swap by distance.

## Final check (all must pass, report the numbers)
- Triangle count per mesh and total for the set (script below), against the budget.
- Texture size and count; one SurfaceAppearance per mesh.
- Part count and draw-call estimate (distinct mesh and material pairs).
- Silhouette still reads at play distance (screenshot at the camera distance the player sees; desktop and phone).
- Pivot, size in studs, collision and render fidelity set, name set.
- Memory: Studio MicroProfiler or `Stats` after placing the set; compare before and after.

## Helpers
- `decimate.py`: Blender batch script. Only when Settings allow Blender: `blender --background --python decimate.py -- in.fbx out.fbx 6000`. Prints faces before and after, writes an FBX.
- `count_tris.luau`: run through Studio MCP `execute_luau` with a model selected; prints triangle (via `GetTriangleCount` where available, else part counts), parts and unique meshes. Edit mode only.

## Sources
- Roblox Creator Docs, "Modeling specifications" and "Texture specifications"; "Meshes" (render and collision fidelity).
