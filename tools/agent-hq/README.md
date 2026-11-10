# Agent HQ

Full owner's guide: [GUIDE.md](GUIDE.md).

A local control room for the Roblox agent team. You message each of 16 role agents individually in a Teams-style chat, approve their output in one inbox ("Needs you"), and watch them work. No npm dependencies, only Node 24+. No `claude` or `agy` command line needed.

## Start

- **Open it:** double-click **"Agent HQ"** on your desktop, or `scripts/Agent HQ.bat`. It starts HQ in the background if it is not running and opens a signed-in tab (`http://127.0.0.1:4317/#owner=<owner token>`).
- **Always on:** run `scripts/install-agent-hq-autostart.bat` once. HQ then starts hidden every time you sign in to Windows, and a keep-alive (`tools/agent-hq/keepalive.mjs`) restarts it within seconds if it crashes. `scripts/uninstall-agent-hq-autostart.bat` removes the autostart and the desktop shortcut.
- **Newest version:** from `Documents\Agent-HQ-App` every launch updates to the newest version of its branch first (`scripts/agent-hq-update.ps1`); see GUIDE.md, Start and stop.
- **Logs:** `.agent-hq/logs/server.log`. **Stop it:** end the two `node` processes in Task Manager (the keep-alive and the server).

The page keeps the owner token in that browser's localStorage and removes it from the address bar. Opening http://127.0.0.1:4317 directly only works in a browser that has signed in once; otherwise it shows "Sign in to Agent HQ", so use the shortcut again. You can also start the server by hand with `node tools/agent-hq/server.mjs`. State lives in `<repo>/.agent-hq/` (gitignored): `hq.db`, `owner-token` (yours), `token` (the agents'), `logs/`, `media/`. Role memory is in `tools/agent-hq/memory/` (committed).

## Using it

- **Team**: a roster of all 16 roles with status (working, queued, review, idle). Click one to open its chat. Whatever you send becomes a task for that role; messages wait their turn while it is working. Buttons: New task, Lessons (what the role has learned), Start fresh (new conversation), Stop (cancel the working task).
- **Lead**: the same chat for the Lead, who plans and delegates to the others.
- **Tasks**: board of queued, working, review and done. Gate tasks carry a "gate" tag and an attempt number.
- **Review**: everything waiting for you: decisions, things to try, images to approve.
- **Pitches / Market / Library / Settings**: scout pitches, Roblox charts, the knowledge vault and skills, lane cadence and budget.

## Pages

- **Games**: one tab per game, with three sub-tabs.
  - *Overview*: version, what is new in it, the next step and a note (both editable), how many times it was sent back for rework, open work with states, what is on your to-do list, and a link to the publish gate.
  - *Live numbers*: a "Connect live numbers" form (see Live telemetry below), then a live strip (playing now, servers, slowest server, worst ping, peak 24 hours, joins and leaves, first-minute bounce, Robux and errors in the last hour, versions running), daily tiles with their source and target (players, visits, like ratio, day-1 and day-7 retention, session length, paying share), and chart tabs: Trends (Roblox public data), Players (daily active users, players per hour, plays by source, day-1 by source, country, language, device), Sessions, money and errors, Where players leave, Benchmarks and a Fix ledger. Anything the game cannot report shows "not measured", never a made-up number.
  - *Pipeline*: nine stages from Pitched to Graded with the role that owns each. The game sits in its current stage; open stage requests and tasks show in their columns, and a drawer holds the stage history. Approve a request, Hold it with a reason, or Reject it with a reason and optional failed-criteria ids (Producer rubric ids such as `G5 S4`). Rejections add to the game's rework count and show in a "Kicked back" list.
- **Publish gate** (`#/games/<slug>/gate`): the irreversible acts only you can do. Make a version live and set the experience public both need two steps: step 1 opens a 2-minute confirmation that changes nothing; step 2 needs you to type the game's slug before the button works, and it only accepts a real mouse click. "Spend ad money" is advisory: it records your note and nothing else. A human-only checklist (played on a phone, checked the store page, read the monetization policy) sits next to the acts, and the reversible review decisions are below a divider. HQ never publishes, goes public or spends money; it only records that you did.
- **Pitches**: tabs for Needs your decision, Waiting on Scout, Your ideas and History. Each card shows the window and the game type (Collect and upgrade, Steal and escape, Survive and extract, Build and defend, Find the hidden, Race and rank, Tycoon and expand, Guess and reveal, Clean and restore, Raise and evolve), how we differ, stat tiles (Money (top earning), top comparable playing, its likes, Growth (upvotes/day), similar games), the money verdict, custom systems to build and the biggest risk, then collapsible sections: The game, Closest competitors, Evidence, Building it, Risks. A pitch missing required fields shows a banner and cannot be approved until the Scout fixes it. Actions: Approve, Edit and approve, Send to Scout (your note goes to the Scout), Decline. Approving one withdraws the other open pitches. Compare lines up 2 or 3 ticked pitches; New game idea hands your own idea (and anything else you want to add) to the Scout.
- **Market**: five steps. 1, Charts: all of the Roblox chart lists (about 23, including Top Earning paged to about 300 games and every genre trending list) with the biggest rank moves between the two latest snapshots, one tab per list, and a table with rank change, players, change, likes, votes and how many lists a game is on. 2, Corpus: reference games with icon and screenshots (click to enlarge), added or removed by universe id. 3, Titles: how the charting games are named (verb, article, noun share, verb-first share, emoji share, word and length distributions, common first words). 4, Benchmarks: the targets a game should hit, how each is measured, what a miss means and where the number comes from. 5, Breakouts: young games that are growing quickly, with a help line under each column. HQ refreshes the market data by itself every `marketEveryHours` hours (a setting, default 6, 0 turns it off); Refresh does it on demand.
- **Library**: Assets (search by name or tag, filter by kind and scope, Roblox upload status, a button that copies the Roblox asset id, click an image to enlarge), Systems (the catalogue in `systems.md`, with a search box), Vault (the knowledge chapters) and Skills.
- **Pitches** also has "Find my next game" (asks the Scout for fresh pitches), a line saying how often the charts refresh, and, when the Scout set it, the art style trending in that format (Stud, Stylized or Realistic). The top earning tile shows "(of N)" only when the rank fits inside the stored list.
- **Market** charts step: snapshot count and start date, players and the biggest jump against the snapshot nearest to the same time yesterday ("not measured" until there is one), Rising right now, New on the charts, Young breakouts, then the six main lists (Trending, Up and coming, Most played, Fun with friends, Most revisited, Top earning, matched by their exact Roblox sort id) and the rest under "More lists". Demo snapshots carry a "Sample data" chip.
- **Pro** (`#/pro/<step>`): ten steps. Rising right now, Chart history (each game opens a 30-day view from HQ's own snapshots), Score my idea (the Scout scores Demand, Competition, Money, First five minutes and Build size from 0 to 10 with evidence), Weekly game ideas (this week's pitches) and Asset packs (from the catalog). The other five are marked Soon and do nothing yet. Nothing is locked.
- **Help**: a short page with Start, Using it, Pages, Live telemetry and Safety.
- **Settings** now starts with the worker lanes strip (Claude app worker, Antigravity design lane, last seen), which used to sit on Home.
- **Phone** (760px wide and below): the sidebar hides. A game strip runs along the top (All games, one tab per game, New game), the page title and New task sit under it, and a bottom bar holds Home, Lead, Tasks, Review and More. More opens a sheet with Team, Games, Pitches, Market, Library, Pro, HQ Link, Settings and Help. Every tap target is at least 44px.

## Game-aware work
`game-context.mjs` infers a task's game (parent task, the owner's selected game, then a single game named in the text), builds the "## Your game" brief section (work folder, docs, Rojo project, game bible chapter) and serves `POST /api/tasks/clear-finished` (owner only). Under All games the Tasks and Review pages group by game.

## Live telemetry

The game reports counts and nothing personal: `StatsService` (in `src/server/Services`) folds joins, leaves, purchases, errors and frame rates into aggregates with no user ids, and every minute writes them to a DataStore called `HQStats`. HQ reads that DataStore through Roblox Open Cloud. Nothing is measurable until the game is published and has players (in Studio the writes fail silently).

1. In the Creator Hub, open the experience, go to Open Cloud, API Keys, and create a key. Give it DataStore read permission for this experience, limited to `HQStats`. No write access, no other permissions.
2. In HQ open Games, Live numbers, Connect live numbers, paste the key and the universe id, and press Save and fetch.
3. HQ keeps the key in `.agent-hq/opencloud.json` (owner-only, never sent back to the page; the page only learns "connected"). It refreshes every 15 minutes, and Refresh does it now.

The Roblox public numbers (players, visits, favorites, likes) only need the universe id.

## Visual bar

In Review, the Visual bar tab holds the images you pinned as house references, by category: Packaging, UI icons, 3D models, Screens. Pin an approved image there and every designer, thumbnails and ui brief lists it as the house reference for every hand-off, so new art matches the look you already approved.

## Roles and skills

`roles.json` is the source of truth. Each role has a model, an `agentType`, the skills it must use, the tools it should prefer, a definition of done, and the roles that check its work (`gates`).

| Role | Runs in | Skills (when) | Gates |
|---|---|---|---|
| lead | Claude app | roblox-agent-team; brainstorming (new idea); writing-plans (3+ steps) | none |
| scout | Claude app | agent-reach, watch, deep-research | none |
| architect | Claude app | writing-plans; grill:roast | none |
| builder | Claude app | test-driven-development; systematic-debugging; verification-before-completion | reviewer, playtester |
| ui | Claude app | roblox-concept-art-ui; taste-skill:redesign-skill; verification-before-completion | reviewer, kid-tester |
| world | Claude app | verification-before-completion | playtester |
| librarian | Claude app | verification-before-completion | reviewer |
| economy | Claude app | test-driven-development; dataviz | reviewer |
| merchant | Claude app | test-driven-development; pricing (research only) | reviewer |
| kid-tester | Claude app | run | none |
| playtester | Claude app | run; systematic-debugging (report, do not fix) | none |
| reviewer | Claude app | code-review; security-review | none |
| producer | Claude app | verification-before-completion | none |
| liveops | Claude app | roblox-launch-tips; dataviz | none |
| designer | Antigravity | art-direction rule + UI concept skill | none |
| thumbnails | Antigravity | art-direction rule + store art skill | none |

Each brief is built from the repo hard rules, the skills to invoke, preferred tools, the role's vault chapters, owned files, the role's lessons, the last messages of the conversation, the task and the definition of done. Only the Lead can create tasks for others.

## Reference library

`research/exemplars/` holds the data agents learn from, read on demand (each file starts with a TL;DR): `core-loops.md` (36 hit games' loops and first-session templates), `mechanics-catalog.md` (~90 engagement mechanics with tuning numbers and idle-economy formulas), `game-ui.md` (Roblox UI facts, screen exemplars, scoring rubric), `thumbnails-icons.md` (store-art specs, 50 exemplars, A/B testing), `market-data-sources.md` (verified Roblox data endpoints, benchmarks, the Run a ___ genre) and `llm-providers.md`. Each role's brief lists only its files (`library` in `roles.json`), so nothing is pasted into every brief.

Briefs are kept small to save usage: up to 3 vault chapters inline (more become a list to read with `hq_vault`), the newest 10 lessons, the last 6 messages; Groq/NIM briefs are smaller still.

## Playbook and knowledge sources

Library > Playbook shows live note and word counts, a search box over the local notes, and the 14 chapters with the roles, LihFolk notes and Creator Hub docs that go with each (`playbook.json`, `GET /api/playbook`). Search covers six sources: the LihFolk Vault V2, Creator Hub docs, owner cards, project research, library repos and community notes. Low-trust notes are screened and what they say is shown to agents as reference data, never as instructions. To use other folders, set "LihFolk vault folder" or "References folder" in Settings, Knowledge (absolute paths; empty means the default place).

## Settings

Settings is drawn from `GET /api/settings/schema` (`settings-schema.mjs`): every field has a label, help text, a control type and a default, and the server validates each save against the same list. Sections: General, Look (dark or light theme, comfortable or compact), Usage, Lanes and schedules, Roles and engines, Art, Knowledge, Notebook and Connections.

## Role overrides

Each role can be turned off, and given extra rules (up to 12) and extra skills (up to 8) from Settings. They are saved in `.agent-hq/roles-override.json` (`POST /api/roles/:id`, owner only) and merged into the role in every brief; `roles.json` is never changed. A task for a turned-off role is refused with a plain message.

## Spend cap and usage savers

"Daily spend cap" (USD, 0 means off) pauses all agents when today's spend since local midnight reaches it, and posts one message to you. HQ never resumes by itself: raise the cap or press Resume. Only runs that report a cost (the Claude CLI engine) count. The other Usage settings shape briefs: terse replies, a screenshot limit per task, cheap vault lookups through a small model, and batching (a worker takes the next task of the role it just ran).

## Art routing

With "Send art to Antigravity" on, a new task whose title is about an icon, thumbnail, ad, key art, store art, banner or promo image goes to the Antigravity lane, unless the creator named an engine or the lane is switched off. Roles that write or check code (builder, economy, merchant, reviewer, playtester, kid tester, producer) are never moved. Blender stays off unless "Allow Blender" is on.

## Readiness

`GET /api/readiness` (and the Readiness panel in Settings) checks Python, the Claude CLI and rojo, each knowledge folder, and every skill each role names: workspace and home skill folders, plugin skills and commands, and file paths. It lists what is missing by name and which notes were held back by the quarantine rules.

## Play

`POST /api/games/:slug/play` (owner only) builds `default.project.json` with `rojo build` into `.agent-hq/builds/<slug>.rbxlx` (no shell) and opens it in the default app. It never publishes. Without rojo or the project file it answers 409 with a plain message.

## Notebook

A short shared log of what the owner and agents learned. The owner writes in the Notebook page; agents read it with `hq_notebook_read` and add with `hq_notebook_add` (their task token is checked; agents cannot delete). Text is up to 2000 characters; the newest 1000 entries are kept. `hqctl notebook` and `hqctl notebook-add <text> --task <id>` do the same. If a Google Doc link is set in Settings the hq-worker mirrors entries to it; HQ itself never calls Google. The game bible (the Doc split by section IDs such as G1.3) is mirrored by the worker with `hq_notebook_mirror` (`hqctl notebook-mirror <file>`) and read one section at a time with `hq_notebook_read {section}` (`hqctl notebook-section <id>`); the Notebook page lists the sections. Routes: `GET /api/notebook/doc`, `GET /api/notebook/doc/:id`, `POST /api/notebook/doc` (owner or lane worker).

## Thumbnail tester

Pro > Thumbnail tester places one of your images in a grid of today's trending game icons (from the market data, nothing copied into the repo), at the size of a PC or phone store row. Chart history is kept for 180 days.

## Quality gates and memory

- **Gates**: when a role finishes, HQ queues its checkers (for example Reviewer and Playtester after a Builder task). A checker starts its summary with PASS or FAIL. FAIL queues a Fix task for the original role with the feedback; after 3 attempts it becomes a decision for you. When every gate passes, the task is marked done.
- **Memory**: roles record reusable lessons (`hq_learn`); the newest 10 are included in every later brief. Edit or prune `memory/<role>.md` by hand if one is wrong.

## Engines and lanes

Work is done by two apps, each pulling tasks from its own lane with the `hq_next_task` MCP tool. A task waits in the queue until a session of that app claims it.

| Engine | Who runs it | Default for |
|---|---|---|
| `app` ("Claude app") | A Claude Code desktop session | every role except designer and thumbnails |
| `antigravity` ("Antigravity (design)") | An Antigravity agent, using its built-in `generate_image` | designer, thumbnails |
| `claude-cli` (optional) | HQ spawns `claude -p` itself (needs the `claude` CLI; `--permission-mode acceptEdits` plus a per-role allow-list) | never |
| `groq` ("Groq") | HQ itself, through `llm-agent.mjs` and your Groq key | never; pick it per role |
| `nim` ("NVIDIA NIM") | HQ itself, through `llm-agent.mjs` and your NIM key | never; pick it per role |
| `echo` | Fake engine for tests and dry runs | never |

The engine is chosen when a task is created: the task's own engine, else the role's setting (Settings, Agent models), else the role default.

### Groq and NVIDIA NIM (save your Claude usage)

1. Settings, Model providers: paste a Groq key (`gsk_...`, console.groq.com) and/or an NVIDIA NIM key (`nvapi-...`, build.nvidia.com). Keys go to `.agent-hq/providers.json` and are never sent back to the page.
2. Settings, Agent models: pick an engine and model per role, or press **Saver preset** (Sonnet for lead, architect and reviewer; scout, kid-tester, producer and liveops on Groq or NIM). Press **Test** next to a Groq/NIM model before relying on it.
3. HQ runs those tasks itself with `llm-agent.mjs`: read, list and search the repo, `fetch_url` for public pages, `write_file`/`edit_file` only inside the role's own `files`, `run_check` only for the role's allow-listed commands (stylua, selene, lune, rojo, luau-lsp...), and the `hq_*` reporting tools. No shell. Gates (reviewer, playtester) still check the work.

The model lists fill themselves: NVIDIA's public catalogue is read at every start and daily (no key needed), Groq's once a key is saved; "Refresh model lists" does it now. The best tool-calling models are listed first and "Auto" picks the top one.

Limits worth knowing (details and sources: `research/exemplars/llm-providers.md`):
- Groq free tier: about 30 requests, 8K tokens a minute and 200K tokens a day per model. HQ keeps each Groq request under about 20K characters by trimming old tool results, and retries 429s.
- NIM: about 40 requests a minute per key across all models. Its list includes models that are no longer served (404/410), so Test a model first.
- Keep Luau code roles (builder, ui, economy) and the Lead on Claude: none of these models has a Luau track record. Use Groq/NIM for research, text review, status and summaries.

### Claude app lane

1. The repo-root `.mcp.json` registers the `agent-hq` MCP server. Open the project in Claude Code desktop.
2. In a session, run `/hq-worker`. It checks HQ is up (and starts it if not), asks the lane gate whether to work, claims tasks, runs each as a subagent with the role's `agentType` and model, and reports back.
3. The unattended run already exists in the Claude app: Scheduled, "Agent HQ worker (hourly check-in)", which runs at :14 past every hour. It only asks the lane gate whether to work, so you change cadence in HQ (Settings > Lanes), not in the app.

### Antigravity lane (design only)

1. Register the HQ tools and the design automation once:
   ```powershell
   node tools/agent-hq/register-antigravity.mjs --dry-run   # preview
   node tools/agent-hq/register-antigravity.mjs             # write (makes .bak copies first)
   node tools/agent-hq/register-antigravity.mjs --remove    # undo
   ```
2. In Antigravity, turn on "Agent HQ design lane" under Automations (HQ never enables it for you), or run `/hq-design` by hand (`.agents/workflows/hq-design.md`).
3. Images are saved to `assets/concepts/` and show up under "Needs you". Approving a designer task queues a `ui` task that rebuilds the concept as Luau.
4. Antigravity must follow the art rules: `.agents/rules/agent-hq-art-direction.md` (strict rules and a scored self-check), `.agents/skills/roblox-ui-concept/SKILL.md` (UI mockups) and `.agents/skills/roblox-store-art/SKILL.md` (icons, thumbnails, passes, products, badges). Every antigravity brief points at them.

## Cadence

The outside schedulers fire at a fixed base rate: the Claude app task hourly, the Antigravity automation every 5 minutes (`node register-antigravity.mjs --every <minutes>` sets it; keep it equal to Settings > Lanes). On every fire the worker first calls the lane gate (`hq_lane_gate`). HQ decides from Settings > Lanes whether it works now, so you change cadence in HQ, never in the apps.

Per lane you can set: Enabled, Work every (Claude app 1 to 24 hours, Antigravity 5 minutes to 24 hours), Active hours from/to, and Max tasks per run. Overnight windows work (for example 22:00 to 06:00). The gate says no when the lane is disabled, HQ is paused, the queue is empty, it is outside active hours, or the lane ran too recently. A person asking in chat (`manual`) skips the hours and spacing checks but not the disabled, paused and empty checks. Times are this computer's local time.

Run on schedules or events, not 24/7, or you burn usage. Pause HQ when you step away.

Recurring tasks (Settings, Schedules), where present, are separate: they enqueue a task every N minutes.

## hqctl (when MCP tools are not loaded)

```powershell
node tools/agent-hq/hqctl.mjs --help
node tools/agent-hq/hqctl.mjs gate app --manual
node tools/agent-hq/hqctl.mjs next app
node tools/agent-hq/hqctl.mjs complete <taskId> "summary" --state review
```

Run it from the repo root. It reads `.agent-hq/token`, talks to the local server and prints JSON. It also has `note`, `ask`, `media`, `learn`, `pitch`, `market`, `notebook` and `notebook-add`.

## Why this beats one Claude chat

- Specialists with only their own vault chapters, skills and tools, instead of one chat holding everything.
- Automatic review: a Reviewer and a tester check every code change and send failures back, up to 2 rework rounds, before it reaches you.
- Lessons carry over: each role's memory is part of every later brief.
- A persistent conversation per role, so you message the Builder and the Merchant separately.
- Parallel work under a budget, with a Studio lock so only one task drives Studio.
- You only approve: images, decisions, things to try. Agents never publish, spend Robux or install tools.

## Safety

- Binds `127.0.0.1` only. Every `/api/*` call except `/api/health` needs the `x-hq-token` header. There are two credentials: the owner token (`.agent-hq/owner-token`, used only by the dashboard and never embedded in the page; it reaches the browser in the URL fragment, which is never sent to the server) and the agent token (`.agent-hq/token`, read by MCP and `hqctl`, which cannot do owner-only things such as approving or marking a game live). No CORS.
- Bodies over 1 MB are rejected; every input is validated. Spawned processes use an args array, never a shell.
- Agents never publish, spend Robux or install tools (see `CLAUDE.md`). Anything the owner must decide shows up under "Needs you".
- Studio is shared: one task holds the Studio lock at a time.
- The publish gate and the Open Cloud key are owner-only: agent tokens get a 403, the key is never returned by any route, and going live or public needs the typed slug and a real mouse click.
- Each claimed task carries its own `taskToken`, printed in its brief. Calls that act on a task (`hq_complete`, `hq_note`, ...) must present that task's token, so one agent cannot report on another's task. The worker gives each brief to its own subagent only and passes the matching token when it completes a task itself.
- HQ never turns on the Antigravity automation or a Claude app scheduled task for you.

## Tests

```powershell
cd tools/agent-hq
npm test                 # unit tests, then the smoke run
node test/smoke.mjs      # end to end with the echo engine, prints PASS
```

## References before 3D work
When a world, librarian, builder, designer or ui task looks like 3D model work (3D, mesh, prop, vehicle, creature, statue, low poly, Blender, sculpt), HQ holds it and queues "Reference sheet: <title>" for the designer first. The designer researches the object, attaches 4 or more views on a plain background, and describes size, parts, materials, budget and style. The held task is then queued once, with the image paths and description added. Settings, Art: "Find references before 3D work", "References approval" (wait for your OK, or go ahead on its own) and "References lane" (Antigravity, or ChatGPT on the app lane). Code is in `model-refs.mjs`.


Games: the Lead can create one (`hq_game_create`), tag tasks with `game`, and move work with `hq_task_move` or `POST /api/tasks/:id/game` (moves child and gate tasks too). Code is in `games-admin.mjs`.

### Run mode, instant results and learning (r5e)
Settings > Run control > Run mode: `instant` (default) sends every role whose default engine is `app` to `claude-cli`, which starts on this PC within seconds; `hourly` keeps them for the Claude app worker. An explicit engine and a per-role engine choice always win, and Antigravity roles stay on Antigravity (`run-mode.mjs`, `db.mjs` `createTask`). When a task a Lead plan created finishes, fails or reaches review, a line appears in the Lead's thread at once, and when every task of the plan has settled HQ queues one "Results in: <title>" task for the Lead (at most 3 rounds). A reviewer's FAIL becomes a lesson for the worked role (`memory/<role>.md`), an owner message that criticises ("no", "wrong", "don't", "instead", ...) becomes an owner correction, and a rejected or held stage request saves its reason for the role that asked (`learning-hooks.mjs`). `npm test` runs with `HQ_RUN_MODE=hourly` through `test/hourly-setup.mjs` because the older tests assume the app lane.
