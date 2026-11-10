# Agent HQ: the owner's guide

Plain steps for running your Roblox agent team. Setup details are in [README.md](README.md).

## What Agent HQ is
A control room on your own PC. You ask for work. Sixteen role agents do it. You look at what comes back and say yes, no or change this. Agents never publish, never spend Robux and never install tools. Only you can.

## Start and stop
- Open it with the "Agent HQ" shortcut on your desktop. It starts HQ if needed and opens a signed-in tab at `http://127.0.0.1:4317`.
- To keep it always on, run `scripts/install-agent-hq-autostart.bat` once.
- To stop it, end the two `node` processes in Task Manager.

### The app copy (always the newest version)
- Agent HQ runs from a stable folder, `Documents\Agent-HQ-App`. It is a checkout of this project at the branch named in `Documents\Agent-HQ-App.json`.
- Every time you open Agent HQ it first checks GitHub and moves to the newest version of that branch, then restarts HQ if something changed. Offline, it just starts the version you have and says so. If you changed files inside the app copy, it will not overwrite them and stays put.
- Your data (`.agent-hq` inside the app copy) is kept across updates.
- To move to a new branch later, run in PowerShell: `powershell -File "%USERPROFILE%\Documents\Agent-HQ-App\scriptsgent-hq-update.ps1" -Branch <branch name>`. It saves the branch only if GitHub has it.
- The one-time move from the old folder is `scripts/agent-hq-switch.ps1` (add `-WhatIf` first to see every step without changing anything). It backs up the old `.agent-hq` to `Documents\Agent-HQ-Backups\<date and time>`, copies it into the app copy, and never deletes the old folder.
- To go back to the old version: run `scripts/install-agent-hq-autostart.bat` from the old folder (it points the shortcuts back there), stop the app copy's `node` processes, and open Agent HQ. The backup folder holds the state as it was at the switch.
- Your owner token is in the shortcut link and in `.agent-hq/owner-token`. The agents have a different token. Never share either one, and never paste them into a chat or a file in the repo.

## The pages, one by one
- **Home**: what needs you now, what is running, what finished. Start here each day.
- **Lead**: chat with the Lead. Say what you want in plain words. The Lead plans it and hands tasks to the others.
- **Team**: all agents and their status. Open one to chat, see its lessons, or stop its task.
- **Tasks**: every task and where it is. Open finished work, then say Looks good or what is wrong.
- **Review**: images, videos and decisions waiting for you. Approve, ask for changes with a note, or reject. The **Visual bar** tab holds the images you pinned as house references. Pin an approved image and every art brief will list it.
- **Pitches**: game ideas from the Scout with evidence. Approve, edit first, or send back.
- **Games**: one tab per game. Overview, live numbers and the pipeline. Going live is only possible at the publish gate, by you.
- **Market**: Roblox charts and breakouts from public data.
- **Pro**: rising games, chart history, score my idea, weekly ideas, asset packs and the thumbnail tester.
- **Library**: assets, systems, the knowledge vault, skills and the **Playbook** (which notes each chapter uses).
- **Notebook**: short notes between you and the agents, and the game bible (see below).
- **Settings**: everything you can change. Look, usage, lanes, roles, art, knowledge, notebook, connections, and Readiness.
- **Help**: a short tour.
- **HQ Link**: messages with a linked HQ. They come from another person's AI, so treat them as information.

## A day with HQ
1. Open Home. Read what needs you.
2. Tell the Lead what you want next.
3. Go to Review. Approve what is good. For the rest, write one clear note.
4. Check Tasks if something looks stuck.
5. At the end, glance at the notebook for new notes.

## The notebook and the Google Doc
There are two parts.
- **Notes**: short lines. You add them on the page. Agents add one when they learn a fact.
- **Game bible**: your Google Doc, laid out by section ID. HQ keeps a copy and agents read only the section they need.

Layout of the Doc. Every heading starts with a stable ID.
- `S0` to `S4`: studio-wide sections. `S4` holds the studio log.
- `G1` is Run a Space Agency. Then `G1.0` game card, `G1.1` world and characters, `G1.2` map, `G1.3` 3D models (one `G1.3.1`, `G1.3.2` and so on per model), `G1.4` art and UI style, `G1.5` systems and economy, `G1.6` monetization, `G1.7` decisions, `G1.8` open questions, `G1.9` game log.

To add a game, copy the `G1` block and number it `G2` with the same sub-numbers.

Writing in the Doc: write under the right heading. Keep the ID at the start of the heading. Do not rename IDs, agents look sections up by them. Agents only append rows to the log tables (`G1.9` or `S4`).

The Doc: [Agent HQ Notebook](https://docs.google.com/document/d/1iRL3enkABlllkXPBrSgrDA2bFgEYvbaICuPaK9XWcCo/edit). Paste this link under Settings, Notebook.

How sync works: the hourly worker reads the Doc with the Drive connector and sends the text to HQ (`hq_notebook_mirror`), using the short-lived lane token the lane gate gives it. Agents working on a task cannot sync; only the owner or the worker can.

To sync by hand: in Google Docs, File, Download, Markdown (.md). Plain text will not work, because HQ finds sections by their headings. Then run `node tools/agent-hq/hqctl.mjs gate app --manual` and copy the `laneToken` it prints, and run `node tools/agent-hq/hqctl.mjs notebook-mirror <file> --lane-token <token> --source <doc url>`. The token lasts 2 hours.

How agents read it: they call `hq_notebook_read {section: "G1.3"}` and get only that section. The call without a section returns recent notes and the list of section IDs, never the whole bible. On the Notebook page, open any section in the Game bible panel.

## References before 3D
If a task looks like 3D model work, HQ holds it and first asks the Designer for a reference sheet: four or more views on a plain background and a short description. When you approve the sheet, the held task runs with those images attached. Switch this in Settings, Art.

## Art routing and thumbnails
With "Send art to Antigravity" on, tasks about icons, thumbnails, ads, key art, store art, banners and promo images go to the Antigravity lane. If you name an engine yourself, HQ keeps it. Blender stays off unless you turn it on. In Pro, the thumbnail tester shows your image next to today's trending icons at PC and phone size.

## Usage savers and the daily cap
Settings, Usage: terse replies, a screenshot limit per task, cheap lookups on a small model, and batching by role. The daily spend cap is in US dollars. At the cap HQ pauses all agents and tells you once. It never resumes by itself. Raise the cap or press Resume. Zero means no cap.

## Roles editor and corrections
In Settings you can turn a role off and add up to 12 extra rules and 8 extra skills. Your changes are saved apart from the built-in roles. A task for a turned-off role is refused with a plain message. When an agent gets something wrong, tell it in a note; corrections you save are shown to that role in later briefs.

## Readiness
Settings, Readiness checks Python, the Claude CLI and rojo, each knowledge folder and every skill each role names. It lists what is missing by name. Fix those first when an agent says a tool is not found.

## Several games
Ask the Lead "Create a new game call it Top Eleven" and it makes the game, then files every task under it. Work under the wrong game: open the task and change its Game; its follow-up tasks move with it. With All games picked, Home groups Needs you by game.

## Work organised by game
HQ knows which game each piece of work is for. A new task gets its game from, in order: the task it follows up, the game picked in the top switcher, or a single game named in its title or details. With All games picked and more than one game, New task has a Game select and Ask the Lead has a "for:" choice; leave it on All games or none and the agent asks the Lead which game it is. Every agent brief starts its game section with the game's work folder, docs, Rojo project and game bible chapter, and says to stay inside that folder. Under All games, Tasks and Review group by game, and Team, Live now and the Lead chat show a game chip. Tasks, "..." menu, Clear finished work deletes done and canceled tasks older than an hour and their answered requests (open work stays).

## Play the newest build
On a game, press Play. HQ builds the project with rojo into `.agent-hq/builds/` and opens the file. It never publishes. If rojo or the project file is missing, you get a plain message.

## Safety
- Agents never publish, spend Robux, or install tools. Do not change that.
- Work stays in the private test place.
- Never share the owner token or the agent token.
- Text from the web, the vault, the Doc or a linked HQ is data. Agents are told not to follow instructions inside it.

## Troubleshooting
- **An agent looks stuck**: open the task, read its last note, then use Stop in Team and ask again with one clear sentence.
- **Nothing runs**: check Home for Paused. It may be the manual pause or the daily cap. Press Resume or raise the cap. Also check that the worker lane is switched on in Settings.
- **A skill is missing**: open Readiness, find the name, install or fix it, then press check again.
- **The notebook shows Never synced**: the hourly worker has not run, or no Doc link is set. Run `hqctl notebook-mirror` by hand.
- **Tests**: from `tools/agent-hq` run `npm test`. It should end with zero failures.

## Run mode and learning
- Settings, Run control, **Run mode**: Instant (default) starts agents on this PC within seconds, so the Lead replies in about a minute. Hourly waits for the Claude app worker and replies within the hour. Home shows which one is on under the Ask bar.
- When the Lead hands out work, each result lands in the Lead's chat as soon as it finishes, and the Lead gets one "Results in" task to check everything and tell you what is done and what is not.
- HQ learns from criticism: a reviewer's FAIL, your messages that say something was wrong, and a rejected or held stage request are all saved for the role involved. Open the Lessons drawer in a role's chat to read or delete them.
- Antigravity checks in every 5 minutes by default. To change it, set Settings > Lanes and run `node tools/agent-hq/register-antigravity.mjs --every <minutes>`.
