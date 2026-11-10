// Demo studio for looking at the UI: real server, temp state, no agents running, no network. Run: npm run demo (HQ_PORT, default 4400).
// The signed-in link is written to <state>/demo-url.txt, never printed.
// Everything here is about Run a Space Agency. Market numbers, spin-off pitches and idea scores are SAMPLE data, labelled as such.
import { parseSections } from '../notebook-doc.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addMessage, createAsk, createGame, createPitch, createTask, getGame, latestMarketSnapshots, saveMarketSnapshot, setSetting, updateGame, updateTask } from '../db.mjs';
import { computeBreakouts } from '../market.mjs';
import { recordPoints, upsertMeta } from '../market-history.mjs';
import { normalizePitch } from '../pitches.mjs';
import { startServer } from '../server.mjs';
import { saveResearchNote } from '../research-notes.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const stateDir = process.env.HQ_DEMO_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hq-demo-'));
const offline = async () => { throw new Error('the demo is offline'); };
const s = await startServer({
  root, port: Number(process.env.HQ_PORT) || 4400, stateDir, dbFile: path.join(stateDir, 'hq.db'), memoryDir: path.join(stateDir, 'memory'), // the demo never writes to the repo's memory folder
  fetchCharts: offline, fetchers: { details: async () => ({}), icons: async () => ({}), thumbnails: async () => ({}) },
});
const { db } = s;
const HOUR = 3600e3;
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();

setSetting(db, 'ownerName', 'Priya');
if (!getGame(db, 'space-agency')) throw new Error('the server seeds space-agency'); // the only game
updateGame(db, 'space-agency', { stage: 'designed', nextStep: 'The plans (numbers, store, UI, map, look) and the Librarian gathers the assets' });

// ---- tasks: finished work waiting for the owner, work in flight, queued work, and done work with a cost ----
const task = (role, title, state, extra = {}) => {
  const t = createTask(db, { role, title, body: extra.body ?? '', game: extra.game ?? 'space-agency', createdBy: 'lead' });
  if (state !== 'queued') updateTask(db, t.id, { state, startedAt: ago(extra.startedAgo ?? HOUR), summary: extra.summary ?? null, costUsd: extra.costUsd ?? null });
  return t;
};
const thumbs = task('thumbnails', 'Launch trailer and two thumbnails for Run a Space Agency', 'review', { costUsd: 0.42, summary: 'Cut a 40 second trailer from the build: the launch pad, the first mission, the map and the Titan flyby. Made two thumbnails, one on the title and one on the rocket.' });
task('ui', 'Mission reveals: Orbit, Moon and Titan', 'review', { costUsd: 0.31, summary: 'Three mission reveals. The countdown ends, the payout lands and the planet lights up in its colour. Rare trips take the whole screen; common ones stay small.' });
task('builder', 'Launch failure: staging and the abort button', 'working', { costUsd: 0.18 });
task('ui', 'Rocket shop: compare tabs and the Saturn unlock', 'working');
const eco = task('economy', 'Tune the first rocket price', 'working', { costUsd: 0.07 });
task('world', 'Launch pad pass: gantry lights and the fuel farm', 'queued');
task('kid-tester', 'Play build 12 on a phone: the first ten minutes', 'queued');
task('librarian', 'Find 12 rocket models and a launch gantry', 'queued');
for (const [role, title, days, cost] of [['playtester', 'Playtest build 11: the first session', 1, 0.22], ['builder', 'Fix the countdown that restarted on rejoin', 2, 0.35], ['architect', 'Plan the Titan mission tier', 3, 0.51], ['librarian', 'Register the rocket icons in the asset index', 5, 0.09], ['economy', 'Set the Mars payout curve', 6, 0.14]]) {
  task(role, title, 'done', { startedAgo: days * 24 * HOUR, costUsd: cost, summary: 'Done and checked.' });
}

// A second SAMPLE game (invented, labelled) so grouping by game shows under All games.
createGame(db, { slug: 'sample-eleven', name: 'Sample Eleven' });
const sg = { game: 'sample-eleven' };
task('ui', 'Sample: lineup screen with drag to swap', 'review', { ...sg, costUsd: 0.2, summary: 'Sample result: a lineup grid where players swap by drag.' });
task('builder', 'Sample: match clock and half time', 'working', sg);
task('economy', 'Sample: transfer budget curve', 'queued', sg);
createAsk(db, { taskId: task('architect', 'Sample: league format', 'review', sg).id, role: 'architect', kind: 'decision', title: 'Sample: eight or twelve teams per league?', why: 'Sample question for the second game.', options: [{ id: '8', label: 'Eight', recommended: true }, { id: '12', label: 'Twelve' }] });

// finished work is linked to its task, as hq_add_media does
createAsk(db, { role: 'thumbnails', taskId: thumbs.id, kind: 'review', title: 'Use this thumbnail?', why: '', mediaPath: 'assets/marketing/thumbnail_draft.png' });
createAsk(db, { role: 'thumbnails', taskId: thumbs.id, kind: 'review', title: 'Use this icon?', why: '', mediaPath: 'assets/marketing/icon_draft.png' });
createAsk(db, { role: 'economy', taskId: eco.id, kind: 'decision', title: 'Raise the first rocket price to 500?', why: 'Players reach it in 40 seconds, the target is 70.', options: [{ id: 'yes', label: 'Raise it', recommended: true }, { id: 'no', label: 'Keep it' }] });

// ---- two SAMPLE spin-off pitches (the second one carries a look) ----
const spinOff = (title, oneLiner, format, look) => normalizePitch({
  title, oneLiner, format, window: 'early', look, edge: 'Same rocket fantasy as Run a Space Agency, with a different core loop.',
  competitors: [{ name: 'Sample game 3', whatItIs: 'Sample competitor', gap: 'No shared moment for the whole server', universeId: 9000003 }],
  comparables: [{ name: 'Sample game 3', universeId: 9000003, playing: 52000, likeRatio: 88, upvotesPerDay: 1200, rankClimb: 4 }],
  money: { verdict: 'Sample verdict: mid-table earner.', topEarningRank: 212, comparable: 'Sample game 3' }, saturationCount: 7,
  game: { howItPlays: 'Sample loop.', first60s: 'Launch the first rocket in 15 seconds.', goal10to15: 'Unlock the second planet.', minutes10to20: 'Upgrade and repeat.', monetization: 'Cosmetics and boosts, never paid luck.', clipMoment: 'The launch countdown.', iconIdea: 'A rocket and a planet.', modules: ['Net', 'Launch'] },
  evidence: { summary: 'Sample data for the demo, not from the real charts. Re-check against live numbers before using it.', links: ['https://create.roblox.com/docs/discovery'] },
  building: { gaps: ['A second map'], assetNotes: 'Reuse the rocket models.', experience: 'About two weeks' }, risks: ['Sample data only'],
});
for (const d of [
  spinOff('Cargo Dash (sample pitch)', 'Deliver cargo between space stations before the timer runs out.', 'Race & rank', undefined),
  spinOff('Moon Base Builder (sample pitch)', 'Grow a Moon base from one dome to a busy colony with your friends.', 'Tycoon & expand', 'stylized'),
]) createPitch(db, { title: d.title, oneLiner: d.oneLiner, data: d });

// ---- SAMPLE market history: 120 snapshots, 6 hours apart, ending now. Every snapshot says sample: true. ----
const SORTS = [['top-trending', 'Trending'], ['up-and-coming', 'Up-and-Coming'], ['top-playing-now', 'Top Playing Now'], ['fun-with-friends', 'Fun with Friends'], ['top-revisited', 'Top Revisited'], ['top-earning', 'Top Earning']];
const STEPS = 120; const GAMES = 42;
const firstStep = (n) => (n === 41 ? 100 : n === 42 ? 110 : 0); // two games reach the charts in the last week
const RISERS = { 3: [114, 0.15], 5: [115, 0.2], 7: [112, 0.06], 9: [113, 0.08], 12: [116, 0.12], 15: [110, 0.03], 18: [114, 0.1], 22: [117, 0.3] }; // [first step of the climb, growth per step]
// Sample series: a slow trend per game plus two gentle waves and tiny noise, so the sparklines read as trends, not zigzags.
const players = (n, step) => {
  const base = 40000 / n ** 0.7; // game 1 is the biggest
  const trend = 1 + ((n % 5) - 2) * 0.0016 * step; // some games drift up, some down, over the 30 days
  const wave = 1 + 0.045 * Math.sin(step / 13 + n) + 0.02 * Math.sin(step / 5.5 + 2 * n) + 0.006 * Math.sin(step * 1.9 + 3 * n);
  const [from, rate] = RISERS[n] ?? [STEPS, 0]; // a few games climb in the last day
  return Math.round(base * trend * wave * (1 + Math.max(0, step - from) * rate));
};
const gameAt = (n, step) => ({ universeId: 9000000 + n, rootPlaceId: 9100000 + n, name: `Sample game ${n}`, playerCount: players(n, step), up: 8000 + ((n * 37) % 1500), down: 1000 + ((n * 53) % 800), genre: 'Sample', maturity: '', sponsored: false });
const sampleSnapshot = (step) => ({
  fetchedAt: ago((STEPS - 1 - step) * 6 * HOUR), sample: true,
  sorts: SORTS.map(([id, name], k) => ({
    id, name,
    games: Array.from({ length: GAMES }, (_, i) => i + 1).filter((n) => firstStep(n) <= step)
      .map((n) => ({ n, score: id === 'top-earning' ? 40000 / n ** 0.7 * (1 + 0.5 * Math.sin(n * 7)) : players(n, step) * (1 + 0.4 * Math.sin(n * (k + 2))) }))
      .sort((a, b) => b.score - a.score).slice(0, id === 'top-earning' ? 40 : 30).map((x) => gameAt(x.n, step)),
  })),
});
for (let step = 0; step < STEPS; step++) {
  const snap = sampleSnapshot(step);
  recordPoints(db, snap);
  if (step >= STEPS - 30) saveMarketSnapshot(db, snap); // the full snapshots keep only the newest 30
}
upsertMeta(db, Array.from({ length: GAMES }, (_, i) => ({ universeId: 9000000 + i + 1, name: `Sample game ${i + 1}`, visits: Math.round(4e6 / (i + 1)), favorites: Math.round(90000 / (i + 1)), created: '2025-06-01T00:00:00Z', creator: 'Sample studio', maxPlayers: 20 })), new Date().toISOString());
const details = Object.fromEntries([41, 42].map((n) => [9000000 + n, { visits: 45000, created: ago(10 * 24 * HOUR), genre: 'Sample' }]));
setSetting(db, 'breakouts', { rows: computeBreakouts(latestMarketSnapshots(db, 30), details, Date.now()), at: new Date().toISOString() });

// ---- SAMPLE idea scores, through the real routes: one open, one scored ----
const api = async (p, body) => (await fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST', headers: { 'x-hq-token': s.ownerToken, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
// ---- SAMPLE standing preference and research note, so the Lessons drawer and the Library show something ----
await api('/api/memory/studio/preferences', { text: 'Sample preference: say studs, never pixels, in every note.' });
saveResearchNote(stateDir, { title: 'Sample research note: AnimationConstraint', url: 'https://create.roblox.com/docs/animation', summary: 'Sample note, not real research. AnimationConstraint replaces Motor6D on upgraded rigs.', role: 'builder' }, new Date().toISOString().slice(0, 10));

await api('/api/idea-scores', { title: 'Sample idea: space station tycoon', idea: 'Sample idea text. Build a station module by module and trade cargo with other players.' });
const scored = await api('/api/idea-scores', { title: 'Sample idea: asteroid mining', idea: 'Sample idea text. Send drones to asteroids, sell ore, and upgrade the fleet.' });
updateTask(db, scored.taskId, { state: 'done', startedAt: ago(2 * HOUR), costUsd: 0.2 });
await api(`/api/idea-scores/${scored.id}/score`, {
  verdict: 'Sample verdict: wanted, but a crowded field and a big build.',
  rows: [
    { name: 'Demand', score: 8, evidence: 'Sample evidence: Sample game 3 has 52K players and 88% likes.' },
    { name: 'Competition', score: 5, evidence: 'Sample evidence: 7 similar games on the charts.' },
    { name: 'Money', score: 6.5, evidence: 'Sample evidence: the nearest comparable sits at #212 in top earning.' },
    { name: 'First five minutes', score: 7.5, evidence: 'Sample evidence: the first sale lands inside 30 seconds.' },
    { name: 'Build size', score: 3.5, evidence: 'Sample evidence: needs a drone system, an ore market and a second map.' },
  ],
  change: 'Sample advice: cut the second map and ship one asteroid belt first.',
});

// A finished Lead task with a run log (what hq_complete leaves behind), so the Lead chat shows "Worked through N steps".
const plan = createTask(db, { role: 'lead', title: 'Plan the Titan mission tier', body: '', game: 'space-agency', createdBy: 'owner' });
updateTask(db, plan.id, { state: 'done', startedAt: ago(3 * HOUR), endedAt: ago(2.5 * HOUR), summary: 'Wrote the Titan tier plan: three missions, a fuel gate and a 90 second first flight.', costUsd: 0.12 });
const step = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
fs.mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
fs.writeFileSync(path.join(stateDir, 'logs', `${plan.id}.ndjson`), [
  step('hq_memory', { query: 'mission tiers' }), step('hq_task', { role: 'architect', title: 'Design the Titan tier' }),
  JSON.stringify({ type: 'result', result: 'Plan written', total_cost_usd: 0.12 }),
].join('\n') + '\n');
addMessage(db, { role: 'lead', from: 'owner', text: 'plan the Titan mission tier' });
addMessage(db, { role: 'lead', from: 'agent', text: 'Planned. Three missions, a fuel gate before Titan, and a **90 second** first flight. **Architect** takes the design next.', taskId: plan.id });
addMessage(db, { role: 'lead', from: 'owner', text: 'can missions get their own reveal? like a big moment' });
addMessage(db, { role: 'lead', from: 'agent', text: 'Yes. **UI** is making a reveal per mission tier: the countdown ends, the payout lands and the planet lights up. Rare trips take the whole screen; common ones stay small.' });
addMessage(db, { role: 'lead', from: 'owner', text: "how's it going?" });
addMessage(db, { role: 'lead', from: 'agent', text: 'Going well. **Build 12** is ready and both bugs Playtest found are fixed. Builder is on launch failure, and UI is on the rocket shop.\n\nIn Review for you: the **trailer and two thumbnails**, and the **mission reveals**.' });

// ---- SAMPLE notebook entries (invented for the demo; one from the owner, two from agents) ----
const note = (who, role, text, agoMs) => db.prepare('INSERT INTO notebook (id, at, who, role, game, text) VALUES (?,?,?,?,?,?)')
  .run('n_' + crypto.randomBytes(6).toString('hex'), ago(agoMs), who, role, 'space-agency', text);
note('agent', 'economy', 'Sample note: the first rocket should cost about 40 seconds of play. Anything under 25 felt free in the sample runs.', 5 * HOUR);
note('agent', 'kid-tester', 'Sample note: the countdown text was too small to read on a phone. Needs a bigger font before the next test.', 3 * HOUR);
note('owner', null, 'Sample note: no paid luck, ever. Cosmetics and boosts only.', HOUR);

// ---- SAMPLE game bible mirror (invented text, labelled sample; in real use the hourly worker mirrors the owner's Google Doc) ----
fs.writeFileSync(path.join(stateDir, 'notebook-doc.json'), JSON.stringify({ syncedAt: ago(20 * 60 * 1000), source: null, sections: parseSections([
  '# **S0 Studio rules**', 'Sample: small team, Mild maturity, no paid luck.',
  '# **G1 Run a Space Agency**', 'Sample game card text.',
  '## **G1.1 World and characters**', 'Sample: a bright cartoon solar system. The crew are friendly space mice.',
  '## **G1.2 Map**', 'Sample: Earth, Moon, Mars, Titan on one stylised map.',
  '## **G1.3 3D models**', 'Sample list of rockets.', '### **G1.3.1 Starter rocket**', 'Sample: round and chunky, red nose.',
  '## **G1.4 Art and UI style**', 'Sample: **big** rounded shapes, bold colours.', '# **G2 Sample Eleven**', 'Sample game card text for the second game.'].join('\n\n')) }));

// HQ_DEMO_EXTRA=1 adds the rarer Home states (a held ask, a try-it ask, a failed gate, a built game) so they can be looked at.
if (process.env.HQ_DEMO_EXTRA) {
  const held = (await (await fetch(`http://127.0.0.1:${s.port}/api/asks?state=open`, { headers: { 'x-hq-token': s.ownerToken } })).json()).find((a) => a.kind === 'review' && a.mediaPath);
  await api(`/api/asks/${held.id}/answer`, { answer: 'hold:Waiting for the second pass' });
  await api('/api/asks', { role: 'kid-tester', kind: 'try', title: 'Try the countdown on your phone', why: 'Open the build on a phone and tell us if the countdown is readable.' });
  await api('/api/asks', { role: 'builder', kind: 'decision', title: 'Gate failed 3 times: Launch failure: staging and the abort button', why: 'The reviewer found the abort button does not reset staging.', options: [{ id: 'retry', label: 'Retry', recommended: true }, { id: 'drop', label: 'Drop' }] });
  updateGame(db, 'space-agency', { stage: 'built' });
}

fs.writeFileSync(path.join(stateDir, 'demo-url.txt'), `http://127.0.0.1:${s.port}/#owner=${s.ownerToken}\n`);
console.log(`Demo HQ on port ${s.port}. Signed-in link: ${path.join(stateDir, 'demo-url.txt')}`);
const stop = async () => { await s.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
