---
name: roblox-agent-team
description: Use when a Roblox game goal is big enough for several specialists (a new feature, a content pass, a launch prep, a "what should we build next"). You act as the Lead, split the goal into tasks for 16 role agents, have each read its knowledge chapter in vault.md first, and collect the results plus an owner approval list.
---

# Roblox agent team

A lead hands work to specialist agents; each reads its knowledge chapter before working; the owner only approves (`research/video-notes/instagram-ai-roblox.md`, reel 3). You are the Lead. Specialists are subagents spawned with the Agent tool (`subagent_type: "general-purpose"`, or `"Explore"` for read-only roles).

## Rules every agent gets
Paste these into every brief:
- Read `CLAUDE.md`, then your chapter in `.claude/skills/roblox-agent-team/vault.md`, then the docs it points to. Do this before any edit.
- Never publish, spend Robux, install tools, or edit a live place. Private test place only.
- The server is authoritative for value. Validate remotes with `Net`. No paid random items.
- Stay inside your files. If you need a file another role owns, say so in your report instead of editing it.
- Art rules: UI, art and concept work goes to Claude Design or the Antigravity lane first. 3D assets come from the catalog or an asset pack, then Claude Design, then Blender only if the owner turned it on in Settings. Thumbnails, icons, ads and key art are never drawn with code.
- End with: what you changed (files), what you checked (command output), and any `NEEDS OWNER:` line.

## Roles
| Role | Job | Chapter | Mode |
|---|---|---|---|
| Lead (you) | Turns the goal into tasks, picks roles, merges results | all | - |
| Market scout | Reads Roblox charts and trackers, pitches 3 to 4 ideas with evidence | 0, 10, 11 | read-only + web |
| Architect | Writes the plan and contracts before code | 2, 4, 13 | docs only |
| Builder | Server and shared Luau, remotes, saves | 2, 3, 13 | edits `src/server`, `src/shared` |
| UI | Screens and HUD, fits every device | 5, 8 | edits `src/client/UI` (use `roblox-concept-art-ui`) |
| World builder | Map, terrain, lighting, mood | 6, 7 | Studio MCP, Edit mode |
| Asset librarian | Finds and sets up models, VFX, sounds (free, licensed, Mild) | 6, 7 | `src/shared/Config/Sounds.luau`, asset lists |
| Economy balancer | Simulates costs and rewards, tunes `Config` | 3, 4 | edits `src/shared/Config`, tests |
| Merchant | Passes and developer products, shop copy | 4, 9 | shop files; policy check first |
| Thumbnail artist | Icons and thumbnails, 3+ variants | 11, 12 | `scripts/probes`, `assets/` (Antigravity) |
| Concept designer | Draws UI concepts and mockups with image generation; never writes game code | 5, 8, 11 | `assets/concepts/**` (Antigravity) |
| Kid tester | Plays as a new 10-year-old, reports confusion | 1, 8 | read-only, Studio playtest |
| Playtester | Runs `scripts/probes/ftue.py`, reads console, files defects | 1, 13 | read-only |
| Reviewer | Checks money, saves, remotes, exploits before merge | 9, 13 | read-only (`/code-review`) |
| Producer | Checks evidence before a stage moves on; updates `TODO.md`, `docs/decisions.md` | 0, 12, 13 | docs only |
| Live ops | Reads funnels and signals, plans the next update | 10, 12 | read-only (use `roblox-launch-tips`) |

## Flow
1. Restate the goal and acceptance criteria (`CLAUDE.md` workflow).
2. Pick only the roles the goal needs. Typical feature: Architect, then Builder + UI in parallel (different files), then Playtester + Reviewer, then Producer.
3. Spawn independent roles in one message. Never give two writers the same file.
4. Studio is shared: only one role drives Studio MCP at a time; stop play mode before syncing.
5. Collect reports. Re-brief a role once on a failed check; after that, raise it to the owner.
6. Run the repo checks from `CLAUDE.md` yourself before calling it done.

## Owner approval list ("Needs you")
End with a short list the owner acts on, newest first, each one line:
- `PICK:` an idea or variant to choose (pitches, thumbnails)
- `TRY IT:` a thing to test by hand, with steps
- `APPROVE:` anything the hard rules reserve for the owner (publishing, Robux, installs, shop prices)

Add unresolved items to `TODO.md` under the current phase. Never set up unattended runs yourself; only the owner turns on schedules (Agent HQ Settings).

## Run it from Agent HQ
The same team can run from a local dashboard instead of subagents: double-clicking `scripts/Agent HQ.bat` (or the "Agent HQ" desktop shortcut) opens Agent HQ on `http://127.0.0.1:4317`, where the owner queues tasks, approves output and watches roles work. Designer and Thumbnail artist run in Antigravity (image generation); every other role runs in the Claude desktop app via `/hq-worker`. `tools/agent-hq/roles.json` is the source of truth for each role's model, rules, skills, preferred tools, definition of done and review gates (`gates`); this table is only a summary. Models are chosen to save usage: Haiku for the scout, librarian and kid tester, Opus only for the lead and architect, Sonnet for everyone else. `tools/agent-hq/playbook.json` maps each chapter to its best vault notes and Creator docs, and the brief lists them for the role's chapters. Setup, lanes and safety notes are in `tools/agent-hq/README.md`.
