// Daily spend cap. costUsd comes from the claude-cli result, so only those runs count.
import { getSetting, setSetting } from './db.mjs';

/** Dollars spent by tasks that started at or after `iso` (an ISO timestamp). */
export const spentSince = (db, iso) => db.prepare('SELECT COALESCE(SUM(costUsd),0) s FROM tasks WHERE startedAt >= ?').get(iso).s;

const localMidnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * check() pauses HQ when today's spend (since local midnight) reaches `dailySpendCap`.
 * It posts one owner message per day, never resumes by itself, and does not pause again for a cap it already tripped today
 * (so the owner's Resume works; a higher cap that is reached later trips again). Returns true while HQ is paused.
 */
export function createSpendGuard({ db, emit, now = Date.now, postMessage }) {
  return function check() {
    if (getSetting(db, 'paused', false)) return true;
    const cap = getSetting(db, 'dailySpendCap', 0);
    if (!(cap > 0)) return false;
    const mid = localMidnight(now());
    const spent = spentSince(db, mid.toISOString());
    if (spent < cap) return false;
    const day = dayKey(mid);
    const trip = getSetting(db, 'spendTrip', null);
    if (trip?.day === day && trip.cap === cap) return false;
    setSetting(db, 'spendTrip', { day, cap });
    setSetting(db, 'paused', true);
    emit('settings', { key: 'paused', value: true });
    if (trip?.day !== day) {
      postMessage({ role: 'lead', from: 'system', text: `Agents paused: today's spend is $${spent.toFixed(2)}, your daily cap is $${cap.toFixed(2)}. Raise the cap or resume in Settings.` });
    }
    return true;
  };
}
