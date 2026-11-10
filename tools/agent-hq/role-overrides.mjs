// Owner overrides for roles: turn a role off, add rules and skills. Stored beside the database; roles.json stays untouched.
import fs from 'node:fs';
import path from 'node:path';

export class OverrideError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}
const SKILL = /^[\w:-]{1,60}$/;

/** Check a patch and return only the fields it sets. */
export function validateOverride(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new OverrideError('body must be an object');
  const out = {};
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new OverrideError('enabled must be a boolean');
    out.enabled = patch.enabled;
  }
  if (patch.extraRules !== undefined) {
    if (!Array.isArray(patch.extraRules) || patch.extraRules.length > 12) throw new OverrideError('extraRules must be a list of up to 12');
    out.extraRules = patch.extraRules.map((r) => {
      if (typeof r !== 'string') throw new OverrideError('each rule must be text');
      const t = r.trim();
      if (t.length > 200) throw new OverrideError('a rule is too long (max 200)');
      return t;
    }).filter(Boolean);
  }
  if (patch.extraSkills !== undefined) {
    if (!Array.isArray(patch.extraSkills) || patch.extraSkills.length > 8) throw new OverrideError('extraSkills must be a list of up to 8');
    out.extraSkills = patch.extraSkills.map((s) => {
      const t = typeof s === 'string' ? s.trim() : '';
      if (!SKILL.test(t)) throw new OverrideError(`skill "${String(s).slice(0, 30)}" must be letters, digits, colon, dash or underscore (max 60)`);
      return t;
    });
  }
  return out;
}

/** The role with the owner's overrides applied; `override` and `enabled` are added. */
export function mergeRole(role, ov = {}) {
  const extraRules = ov.extraRules ?? [];
  const extraSkills = ov.extraSkills ?? [];
  return {
    ...role,
    rules: [...(role.rules ?? []), ...extraRules],
    skills: [...(role.skills ?? []), ...extraSkills.filter((n) => !(role.skills ?? []).some((s) => s.name === n)).map((name) => ({ name, when: 'Owner added this skill.' }))],
    override: { enabled: ov.enabled, extraRules, extraSkills },
    enabled: ov.enabled !== false,
  };
}

export function createRoleOverrides({ stateDir }) {
  const file = path.join(stateDir, 'roles-override.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } };
  return {
    read,
    set(roleId, patch) {
      const all = read();
      all[roleId] = { ...(all[roleId] ?? {}), ...validateOverride(patch) };
      fs.writeFileSync(file, JSON.stringify(all, null, 1));
      return all[roleId];
    },
    merged: (roles) => { const all = read(); return roles.map((r) => mergeRole(r, all[r.id])); },
  };
}
