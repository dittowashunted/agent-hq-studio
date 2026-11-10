// Run mode: "instant" starts agents on this PC within seconds (claude-cli); "hourly" leaves them for the Claude app worker.
export const RUN_MODES = ['instant', 'hourly'];
/** Default mode. HQ_RUN_MODE exists only so the older tests, which expect the app lane, can run in hourly mode. */
export const defaultRunMode = () => (RUN_MODES.includes(process.env.HQ_RUN_MODE) ? process.env.HQ_RUN_MODE : 'instant');

/** Engine for a new task: explicit, then the owner's per-role choice, then claude-cli (instant mode, role default app), then roles.json, then app. */
export function pickEngine({ runMode = 'instant', explicit, pref, roleDefault } = {}) {
  if (explicit) return explicit;
  if (pref) return pref;
  if (runMode === 'instant' && (!roleDefault || roleDefault === 'app')) return 'claude-cli';
  return roleDefault || 'app';
}

/** Cron for the Antigravity sidecar: every n minutes (5 to 59), else every few hours, else daily. */
export function cronFor(everyMinutes) {
  const n = Math.round(Number(everyMinutes));
  if (!Number.isFinite(n) || n < 5) return '*/5 * * * *';
  if (n < 60) return `*/${n} * * * *`;
  const h = Math.round(n / 60);
  return h >= 24 ? '0 0 * * *' : `0 */${h} * * *`;
}

export const replyHint = (runMode) => (runMode === 'hourly' ? 'The Lead replies within the hour' : 'The Lead replies in about a minute');
