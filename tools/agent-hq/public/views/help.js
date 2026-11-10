// Help: a short tour of how HQ works. Text follows the README sections Start, Using it, Pages, Live telemetry and Safety.
import { h, pageHead } from './core.js';

const SECTIONS = [
  ['Start', [
    ['Open it', 'Use the Agent HQ shortcut on your desktop. It starts HQ if it is not running and opens a signed-in tab.'],
    ['Always on', 'Run the autostart script once and HQ starts hidden when you sign in to Windows. A keep-alive restarts it if it crashes.'],
    ['Signed out?', 'Opening the address by hand only works in a browser that has signed in once. Use the shortcut again.'],
  ]],
  ['Using it', [
    ['Team', 'All 16 agents with their status. Open one to chat. Whatever you send becomes a task for that agent, and messages wait their turn while it works.'],
    ['Lead', 'The same chat for the Lead, who plans the work and hands tasks to the others.'],
    ['Tasks', 'Everything asked for, where it is right now, and what came back. Check finished work, then say Looks good or what is not right.'],
    ['Review', 'Images, videos and decisions waiting for you. Approve, ask for changes with a note, or reject.'],
  ]],
  ['Pages', [
    ['Games', 'One tab per game: overview, live numbers and the nine-stage pipeline. Going live is only possible from the publish gate, and only by you.'],
    ['Pitches', 'Game ideas from the Scout with evidence. Approve one to start, edit it first, or send it back.'],
    ['Market', 'Roblox charts, benchmarks and breakouts from public data, refreshed on a schedule.'],
    ['Library', 'Assets, the systems catalogue, the knowledge vault and skills.'],
    ['Pro', 'Rising games, chart history, score my idea, weekly ideas and asset packs, all from your own HQ data.'],
    ['Full guide', 'The owner's guide is tools/agent-hq/GUIDE.md in the repo: every page, the notebook, usage savers and troubleshooting.'],
    ['Settings', 'How many agents run at once, which model each uses, worker lanes and schedules.'],
  ]],
  ['Live telemetry', [
    ['What it is', 'Your game reports counts only, with no player ids. HQ reads them with a read-only Open Cloud key you create for the HQStats DataStore.'],
    ['Connect it', 'Games, Live numbers, Connect live numbers. Paste the key and the universe id, then Save and fetch. HQ keeps the key on this PC and never sends it back to the page.'],
  ]],
  ['Safety', [
    ['Local only', 'HQ listens on 127.0.0.1 and every call needs your token. Nothing is reachable from other machines.'],
    ['Agents never publish', 'Agents cannot publish, spend Robux or install tools. Anything you must decide appears under Needs you.'],
    ['One Studio', 'Studio is shared, so one task holds the Studio lock at a time.'],
  ]],
];

export function render() {
  return h('div', { class: 'page narrow' },
    pageHead('Help', 'How Agent HQ works, in a few lines.'),
    h('div', { class: 'stack' }, SECTIONS.map(([title, rows]) => h('section', { class: 'card', 'aria-label': title },
      h('h2', { class: 'section-title' }, title),
      h('dl', { class: 'help-list' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'muted' }, v)]))))));
}
