---
name: teach
description: Use when the owner teaches, corrects or sets a preference ("remember...", "from now on...", "always/never...", "don't do that again", "that's wrong, it should be...", "/teach ...") or asks to forget something. Saves the lesson to memory/lessons.md so every later session and every Agent HQ role follows it.
---

# Teach: save what the owner tells us

The lessons file is `memory/lessons.md` (path also in `agent-hq.settings.json` → `learning.lessonsFile`). It is loaded into every Claude Code session through `CLAUDE.md` and into every Agent HQ brief.

## Save a lesson
1. Turn what the owner said into one short rule an AI can follow, in the owner's meaning. Add the reason if they gave one.
2. Read `memory/lessons.md`. If a lesson already covers it, update that line instead of adding a second one. If the new lesson contradicts an old one, replace the old one (the owner's latest word wins).
3. Append `- YYYY-MM-DD: <rule> (<why>)` with today's date.
4. Tell the owner in one line what you saved.

Save corrections too: when the owner says an answer or a build was wrong, save what to do differently, not just "be careful".

## Forget a lesson
Remove the matching line, then tell the owner which line you removed. If several lines could match, ask which one.

## Role-specific lessons
A lesson that only applies to one Agent HQ role (for example "the builder must run the audit before review") goes to that role with `hq_learn`, or to `tools/agent-hq/memory/<role>.md` in the same line format.

## Don't save
Secrets, tokens, passwords, personal details, or one-off instructions that only matter for the current task.
