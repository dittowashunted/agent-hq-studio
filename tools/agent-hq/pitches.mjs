// Pitch schema validation. Pure, no dependencies. normalizePitch throws an Error with .status = 400.
export const WINDOWS = ['early', 'mid', 'late'];
export const ORIGINS = ['scout', 'owner'];
export const LOOKS = ['stud', 'stylized', 'realistic']; // the art style trending in this format (display only)

const MAX_STR = 2000;
const MAX_ITEMS = 20;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function str(v, name, { max = MAX_STR, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const s = v.trim();
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return s;
}

function num(v, name, { int = false, min = 0, max = 1e12 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw bad(`${name} must be ${int ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return n;
}

function list(v, name) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${name} must be an array`);
  if (v.length > MAX_ITEMS) throw bad(`${name} has too many entries (max ${MAX_ITEMS})`);
  return v;
}

const strings = (v, name) => list(v, name).map((x, i) => str(x, `${name}[${i}]`, { required: true }));
const object = (v, name) => {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) throw bad(`${name} must be an object`);
  return v;
};

function link(v, name) {
  const s = str(v, name, { required: true });
  if (!/^https?:\/\/\S+$/i.test(s)) throw bad(`${name} must be an http(s) link`);
  return s;
}

/**
 * Accepts the full schema. Also accepts the older flat form (coreLoop, evidence as a string, risks as a string)
 * so existing callers keep working. Returns the normalized object.
 */
export function normalizePitch(input) {
  if (!isObj(input)) throw bad('pitch must be an object');
  const i = input;

  const window = i.window === undefined || i.window === null || i.window === '' ? null : i.window;
  if (window !== null && !WINDOWS.includes(window)) throw bad(`window must be one of ${WINDOWS.join(', ')}`);
  const origin = i.origin ?? 'scout';
  if (!ORIGINS.includes(origin)) throw bad(`origin must be one of ${ORIGINS.join(', ')}`);
  const look = i.look === undefined || i.look === null || i.look === '' ? null : i.look;
  if (look !== null && !LOOKS.includes(look)) throw bad(`look must be one of ${LOOKS.join(', ')}`);

  const competitors = list(i.competitors, 'competitors').map((c, k) => {
    const o = object(c, `competitors[${k}]`);
    return {
      name: str(o.name, `competitors[${k}].name`, { required: true, max: 200 }),
      whatItIs: str(o.whatItIs, `competitors[${k}].whatItIs`),
      gap: str(o.gap, `competitors[${k}].gap`),
      universeId: num(o.universeId, `competitors[${k}].universeId`, { int: true, min: 1 }),
    };
  });

  const comparables = list(i.comparables, 'comparables').map((c, k) => {
    const o = object(c, `comparables[${k}]`);
    return {
      name: str(o.name, `comparables[${k}].name`, { required: true, max: 200 }),
      universeId: num(o.universeId, `comparables[${k}].universeId`, { int: true, min: 1 }),
      playing: num(o.playing, `comparables[${k}].playing`),
      likeRatio: num(o.likeRatio, `comparables[${k}].likeRatio`, { max: 100 }),
      upvotesPerDay: num(o.upvotesPerDay, `comparables[${k}].upvotesPerDay`),
      rankClimb: num(o.rankClimb, `comparables[${k}].rankClimb`, { min: -1e6 }),
      note: str(o.note, `comparables[${k}].note`),
    };
  });

  const m = object(i.money, 'money');
  const g = object(i.game, 'game');
  const ev = typeof i.evidence === 'string' ? { summary: i.evidence } : object(i.evidence, 'evidence');
  const b = object(i.building, 'building');
  const risks = typeof i.risks === 'string' ? (i.risks.trim() ? [str(i.risks, 'risks')] : []) : strings(i.risks, 'risks');

  return {
    title: str(i.title, 'title', { required: true, max: 200 }),
    oneLiner: str(i.oneLiner, 'oneLiner', { required: true, max: 500 }),
    format: str(i.format, 'format', { max: 200 }),
    window,
    origin,
    ...(look ? { look } : {}), // only when set, so older pitches keep their shape
    edge: str(i.edge, 'edge'),
    competitors,
    comparables,
    money: {
      verdict: str(m.verdict, 'money.verdict'),
      topEarningRank: num(m.topEarningRank, 'money.topEarningRank', { int: true, min: 1 }),
      comparable: str(m.comparable, 'money.comparable', { max: 200 }),
    },
    saturationCount: num(i.saturationCount, 'saturationCount', { int: true }),
    game: {
      howItPlays: str(g.howItPlays ?? i.coreLoop, 'game.howItPlays'),
      first60s: str(g.first60s, 'game.first60s'),
      goal10to15: str(g.goal10to15, 'game.goal10to15'),
      minutes10to20: str(g.minutes10to20, 'game.minutes10to20'),
      monetization: str(g.monetization, 'game.monetization'),
      clipMoment: str(g.clipMoment, 'game.clipMoment'),
      iconIdea: str(g.iconIdea, 'game.iconIdea'),
      modules: strings(g.modules, 'game.modules'),
    },
    evidence: {
      summary: str(ev.summary, 'evidence.summary'),
      links: list(ev.links, 'evidence.links').map((l, k) => link(l, `evidence.links[${k}]`)),
    },
    building: {
      gaps: strings(b.gaps, 'building.gaps'),
      assetNotes: str(b.assetNotes, 'building.assetNotes'),
      experience: str(b.experience, 'building.experience'),
    },
    risks,
  };
}
