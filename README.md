# Agent HQ Studio

Agent HQ, the Roblox AI Studio Vault and the Roblox game gate, installed in one step.

- **`tools/agent-hq/`**: a local control room for a 16-role Claude Code team. It has chat per role, a task board, review gates, a game pipeline and HQ Link.
- **`vault/`**: an Obsidian vault with the operating rules, the Master Prompt, templates and seven Roblox skills.
- **`gate/`**: the quality gate. Every Roblox coding request goes through a vault search, section, asset and standards checks, and an independent review.

## What's new in this version

- **Latest Agent HQ** (from the author's roblox-project, Nov 8 2026): owner corrections and standing preferences, a notebook, the playbook view, Discord bridge, readiness and game checks, a redesigned dashboard and 16 more Roblox skills. Our additions below are applied on top.

- **Search every source at once:** `python -I tools/hq-search/hq_search.py "<task>"` searches the LihFolk vault, the official Roblox Creator Docs, the LihFolk engine reference cards and your project research in one call (about half a second once cached). `--chapter <N>` searches a playbook chapter; `--setup-docs` downloads the Roblox docs text (about 30 MB, once). It finds the vault in `vault/`, `$LIHFOLK_VAULT` or the LihFolk plugin.
- **Claude learns what you teach it:** the `teach` skill saves corrections and preferences ("remember...", "from now on...", `/teach ...`) to `memory/lessons.md`. Every Claude Code session loads it through `CLAUDE.md`, and every Agent HQ brief gets a "What the owner taught us" section.
- **Reference-first 3D modelling:** the `roblox-3d-reference` skill searches real references, writes a brief with real dimensions, makes a concept sheet in Claude Design (never Canva), then waits for your approval unless `agent-hq.settings.json` sets `modeling.approval` to `auto`. The build itself uses the `roblox-3d-model` skill.
- **Your game, not the sample game:** `agent-hq.settings.json` sets the project name every brief uses and the first game in the pipeline.
- **Library:** SVG icons are supported, images under `assets/icons/` count as icons, and folder names (pack, colour, artist) become search tags.
- **Safer re-runs:** the installer keeps your playbook (`roblox-agent-team/vault.md`), asset index, settings and lessons, and finds Claude Code even when `cmd.exe` can't run it.
- Removed a stray empty file in `tools/agent-hq/memory/`. Added `test/settings.test.mjs` (6 tests).

## Install

You need [Node 22.13 or newer](https://nodejs.org), [Git](https://git-scm.com), [Python 3](https://python.org), [Claude Code](https://claude.com/claude-code) and Roblox Studio. Windows is the tested platform.

```bash
git clone https://github.com/bendover19694-wq/agent-hq-studio
```

Then double-click `install.bat` and type your game's folder. Or run:

```bash
node agent-hq-studio/install.mjs --game "C:/path/to/your/game"
```

The installer copies HQ into your game, links the vault, installs the skills, the gate and the LihFolk plugin, and tells you if anything is missing. Keep the cloned folder, because your game's `CLAUDE.md` points at the vault inside it.

Run it again at any time to update. It never touches your own notes, your HQ data or your role memory.

Start HQ with `scripts/Agent HQ.bat` in your game folder.

## HQ Link: work with a friend's HQ

Two HQs on different networks can talk and share tasks through a Discord channel. No ports are opened and no tunnel is needed, because each HQ checks the channel with its own bot.

1. Each person makes a Discord bot and adds it to a shared server. In the [Developer Portal](https://discord.com/developers/applications), turn on **Message Content Intent**. A dedicated channel such as `#hq-link` keeps the JSON posts out of the way.
2. Each person opens **HQ Link** in HQ and saves their bot token. The first person also adds the channel id.
3. Swap invites and paste each other's. An invite holds no secrets.

After that:

- **Talk:** use the HQ Link page. Agents use `hq_link_read` and `hq_link_say`.
- **Share a task:** use the page, or the Lead's `hq_link_share`. It lands in the other owner's **Review**, it only runs if they accept it, and you hear how it ends.

**Safety:**

- Only posts from the paired bot's id count. Anyone else in the channel is ignored.
- Shared tasks never run by themselves, and they go to the other side's Lead with a warning that the text came from outside.
- Linked messages never start an agent, so two AIs cannot run up each other's usage.
- HQ stays on `127.0.0.1`. Your bot token stays in `.agent-hq/link-token` and is never sent to the other HQ.
- Common token formats are stripped from outgoing text, but don't rely on that: never put secrets in a linked message.
- Reset your bot token if it ever leaks, and only pair with people you trust.

Files are not shared over the link. Use Git for those.

## Check it works

```bash
cd tools/agent-hq && npm test
```

Run this from your game's repo. If your game lacks the original project's files, 4 tests fail because they look for files such as `assets/marketing/icon_draft.png`.

## Rules that stay on

- Agents never publish, spend Robux, install tools or edit a live place.
- Work happens in a private test place.
- Never commit `.agent-hq/`, tokens or API keys.

## Credits

- **LihFolk Vault V2** by LihFolk is installed from [its own repo](https://github.com/lihfolk-cy/v2-vault) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The gate's search, code scan and quality rubrics come from it. The LihFolk Asset Pack isn't included: its licence forbids redistributing it, so get it from LihFolk.
- **VFX Forge** isn't included. The vault's VFX skill works with your own copy.
- `vault/04 Research/Research and Provenance.md` lists the other sources.
