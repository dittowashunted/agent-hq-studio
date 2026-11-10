// Art routing: icon, thumbnail, ad and key-art work belongs to the Antigravity lane (image generation), never to code.
const ART = /\b(?:icons?|thumbnails?|ads?|key[ -]?art|store[ -]art|banners?|promo(?:tional)?[ -](?:images?|art|graphics?)|ad[ -](?:creative|images?|art))\b/i;

// Roles that write or check code stay on the Claude lane even if the title says "icon".
const CODE_ROLES = new Set(['builder', 'economy', 'merchant', 'reviewer', 'playtester', 'kid-tester', 'producer']);

export const isArtTask = ({ title = '', body = '' } = {}) => ART.test(`${title}\n${body}`);

/** The engine a new task should get: 'antigravity' for art work when routing is on and that lane is enabled, else task.engine unchanged. */
export function routeEngine(task, settings) {
  if (settings?.artAutoRoute === false || CODE_ROLES.has(task?.role)) return task?.engine;
  // title only: a body that merely mentions an icon must not move a task off its lane
  if (!ART.test(task?.title ?? '')) return task?.engine;
  if (settings?.laneSchedules?.antigravity?.enabled === false) return task.engine;
  return 'antigravity';
}
