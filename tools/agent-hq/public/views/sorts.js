// The six chart lists in the order the owner reads them. No imports, so the unit test can load it in Node.
// Each list is matched by its exact Roblox sort id first. A name pattern is only a fallback (B-D18 as revised).
export const REF_SORTS = [
  { label: 'Trending', id: /^top-trending$/, name: /^(top )?trending$/i },
  { label: 'Up and coming', id: /^up-and-coming$/, name: /^up[- ](and|&)[- ]coming$/i },
  { label: 'Most played', id: /^top-playing-now$/, name: /^(top playing now|most played)$/i },
  { label: 'Fun with friends', id: /^fun-with-friends$/, name: /^fun with friends$/i },
  { label: 'Most revisited', id: /^top-revisited$/, name: /^(top|most) revisited$/i },
  { label: 'Top earning', id: /^top-earning$/, name: /^top earning$/i },
];

/** sorts = [{ id, name, count }]. Returns { main: [{ id, name, label }] in REF_SORTS order, more: [{ id, name, label }] in input order }. */
export function splitSorts(sorts) {
  const left = [...(sorts || [])];
  const found = REF_SORTS.map(() => null);
  // Pass 1: exact ids for all six, so a name fallback can never steal a list that has its own id.
  REF_SORTS.forEach((ref, i) => {
    const at = left.findIndex((s) => ref.id.test(s.id || ''));
    if (at >= 0) found[i] = left.splice(at, 1)[0];
  });
  // Pass 2: name fallback for the lists still missing.
  REF_SORTS.forEach((ref, i) => {
    if (found[i]) return;
    const at = left.findIndex((s) => ref.name.test(s.name || ''));
    if (at >= 0) found[i] = left.splice(at, 1)[0];
  });
  const main = [];
  found.forEach((s, i) => { if (s) main.push({ ...s, label: REF_SORTS[i].label }); });
  return { main, more: left.map((s) => ({ ...s, label: s.name })) };
}
