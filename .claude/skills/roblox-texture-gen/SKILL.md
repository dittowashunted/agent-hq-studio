---
name: roblox-texture-gen
description: Use when a Roblox surface needs a seamless tiled texture (camo, rust, brick, grass, wood, fabric) or PBR maps. Generates through the image lane (Antigravity or ChatGPT), never by drawing with code, checks the tile for seams, and applies it with Texture, MaterialVariant or SurfaceAppearance. Small skill, big visual win.
---

# roblox-texture-gen: seamless tiles that do not look generated

## Rules
- Make textures with the image lane (Antigravity or ChatGPT image generation), per `art-routing`. Never draw them with Luau, SVG or Parts.
- The agent never uploads or publishes; the owner uploads. Private test place only.
- Power-of-two, square. Size by use: 256 for small props (about 5 studs), 512 medium (about 10), 1024 for 20 studs and up. SurfaceAppearance maps are capped at 1024x1024. Formats png, jpg, tga, bmp (Creator Docs, "Texture specifications").

## Prompt recipe (fill the brackets)
"Seamless tileable [material] texture, top-down flat orthographic, even lighting, no shadows, no vignette, no perspective, no objects, no text, no focal feature, the same detail density everywhere, edges match on all four sides, value range [dark..light] inside palette [colours], style [low-poly | painted | realistic] to match [game art direction], [size] square."
Ask for the base colour first. For PBR, request normal, roughness and metalness as separate maps from the same description, or use a grey roughness map; check they tile the same way.

## Check the tile before applying
`python -I tile_check.py tex.png` prints size, power of two and edge mismatch, and saves a 2x2 preview of the half-offset image so seams show in the middle. Seams, a bright blob, a visible hero feature, or mismatch above about 12: regenerate, then repeat. Also view it tiled 4x4 at the size it will appear in game.

## Apply
- Texture on a Part face: set `StudsPerTileU` and `StudsPerTileV` so one tile covers the real size you chose (Roblox default materials show a 1024 tile on an 8 stud face).
- MaterialVariant under MaterialService for a whole Material (best for floors and walls shared by many parts).
- SurfaceAppearance on a MeshPart (ColorMap, NormalMap, RoughnessMap, MetalnessMap), see `roblox-3d-model`.
- Never stretch: keep the tile ratio 1:1 with studs.

## Anti-slop check list
- No smeared or melted detail up close.
- No repeating hero features (one big stain or crack that shows every tile).
- Value range fits the game's palette; not pure white or black; contrast low enough not to fight the UI or the player.
- Roughness not uniform; normal strength modest.
- Looks right on desktop and on a phone at normal camera distance.
- The same material family shares one palette.

## Report
Image paths, sizes, tile_check numbers, where applied, a screenshot at play distance.
