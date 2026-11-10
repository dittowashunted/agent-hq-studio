---
name: roblox-3d-reference
description: Use before building ANY 3D model, prop, vehicle, building or character for this Roblox game. Researches real references on the web first, makes a concept sheet in Claude Design (never Canva), then pauses for owner approval unless agent-hq.settings.json says modeling.approval is "auto".
---

# Reference-first 3D modelling (before roblox-3d-model)

Never start a mesh, part build or Blender script until steps 1–4 are done. This skill is the research and approval stage; the build stage is the `roblox-3d-model` skill (budgets, decimation, UVs, import).

## 1. Vault first
`python -I tools/hq-search/hq_search.py "<model> modelling budget"` and read the matching LihFolk notes (style, triangle budgets, import rules). For Blender work, the plugin skill `lihfolk:roblox-blender-modeling` is the builder; for an owner-supplied image, use `roblox-reference-prop`.

## 2. Real references (Google-style web search)
- Run 2–4 WebSearch queries for the real thing ("<object> parts and proportions", "<object> real dimensions", "<object> stylised low poly reference").
- Write down real descriptions: size in metres and studs (1 stud = 0.28 m), main parts, materials, colours, silhouettes, what makes it recognisable.
- Keep only references we may learn from. Never copy a specific game's model (no GTA vehicles, buildings or characters) or a real brand's logo or exact design without a licence.
- Save it as `research/models/<model-slug>.md`: TL;DR, real description, dimensions, part list, source links, style notes for our art guide, triangle and part budget.

## 3. Concept sheet in Claude Design (not Canva)
- Make it with the Artifact tool: quickstart `intent: "design"`, then build a one-page concept sheet with front / side / top silhouettes, a colour palette, a part breakdown with sizes, and the style notes.
- Never use the Canva tools for this. Link the artifact in `research/models/<model-slug>.md`.

## 4. Approval gate
Read `agent-hq.settings.json` → `modeling.approval`.
- `"ask"` (default, or if the file or key is missing): stop. Show the owner the brief and the concept sheet link and ask for approval. In Agent HQ, use `hq_ask_owner` (kind `review`); in a chat session, ask directly and end the turn. Do not build until the owner says yes.
- `"auto"`: say in one line that settings allow building automatically, then go on.

## 5. Build and check
- Build with the `roblox-3d-model` skill (Studio MCP tools or headless Blender), matching the brief's dimensions and budget.
- Check: scale in studs, pivot placement, triangle and part counts, materials, collision fidelity, and a phone-performance check.
- Screenshot from the same angles as the concept sheet and compare. Score with `lihfolk:quality-score`; the minimum is 8.5/10, reviewed by someone other than the builder.
- Add the asset to `assets/LICENSES.md` (own-made) and Agent HQ's Library.
