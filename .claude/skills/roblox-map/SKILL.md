---
name: roblox-map
description: Use when building or checking a Roblox map or obby-like level. Proves with raycasts (not pathfinding) that every placed part is reachable from spawn using the place's real gravity, jump height, walk speed and slope limit, then fills gaps, adds landmarks, varies repetition and removes the signs of AI. Run in Edit mode through Studio MCP, never Play.
---

# roblox-map: reachable first, believable second

A map fails two ways: a player cannot get there, or it looks machine-made. Fix reachability with numbers, then fix feel.

## 1. Prove reachability (always first)
Run `prove.luau` through Studio MCP `execute_luau`, in Edit mode, never Play. It:
- reads the real `Workspace.Gravity`, `StarterPlayer` jump (`CharacterJumpHeight`, or `CharacterJumpPower` squared over twice gravity), walk speed and `CharacterMaxSlopeAngle`;
- samples each part's standable top surface with downward raycasts and drops points whose normal is steeper than the slope limit;
- links two surfaces when the rise is within 85 percent of jump height and the horizontal gap is within air time times walk speed, with a knee-height line-of-sight raycast so a wall blocks the hop;
- flood-fills from spawn and prints `placed`, `reachable`, `failed`, plus each failed part by full name.

It does not use PathfindingService: pathfinding answers "can an NPC route there", not "can a human jump there".
Caveats: the auto-step height is an assumption (1.5 studs, measure it); moving platforms, ladders, trusses, teleports and speed pads need a manual entry; lower `SAFETY` for kids and phones.
Done when failed is 0, or every failure is explained in the report.

## 2. Fix failures
Do not just shrink a gap blindly. Prefer: add a stepping part, lower the rise, add a ramp inside the slope limit, or move the part. Re-run the proof after every batch.

## 3. Fill and shape
- Fill dead gaps with purpose: a pickup, a view, a rest spot, a shortcut. A part with no purpose is deleted.
- Landmarks: 3 to 5 distinct silhouettes visible from spawn and from the halfway point, so players navigate by sight.
- Vary repetition: change size, rotation (small), height and material every 3 to 4 repeats; never a row of identical pieces.
- Align built pieces to a grid (1 or 2 studs); leave natural pieces off-grid on purpose.
- Remove floating, intersecting and z-fighting parts; anchor everything static.
- One scale language: doors, stairs, rails and props sized against a character about 5 studs tall.
- No raw grey planes: use MaterialVariant or `roblox-texture-gen` output.

## 4. Signs of AI check list (fix or justify each)
- Perfect symmetry or a perfect circle of props.
- Copy-paste rows with identical spacing, size and rotation.
- Mismatched scales between neighbours.
- Untextured or default-material planes, all one colour.
- Parts with no purpose; decoration floating or on nothing.
- Flat ground with no height change; no reason for the path to bend.
- Lighting and fog left at defaults; no focal point.

## 5. Report
Numbers (placed, reachable, failed), screenshots desktop and phone from spawn, the landmark list, anything left unproven. Private test place only.

## Related
`roblox-map-building`, `lihfolk:lihfolk-worldbuilding`, `roblox-vfx-forge`, `roblox-texture-gen`.
