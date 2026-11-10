import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSorts, REF_SORTS } from '../public/views/sorts.js';

const LABELS = ['Trending', 'Up and coming', 'Most played', 'Fun with friends', 'Most revisited', 'Top earning'];
const DEMO = [['top-trending', 'Trending'], ['up-and-coming', 'Up-and-Coming'], ['top-playing-now', 'Top Playing Now'], ['fun-with-friends', 'Fun with Friends'], ['top-revisited', 'Top Revisited'], ['top-earning', 'Top Earning']].map(([id, name]) => ({ id, name }));

test('the demo ids map to the six labels in order', () => {
  assert.deepEqual(REF_SORTS.map((r) => r.label), LABELS);
  const { main, more } = splitSorts([...DEMO].reverse());
  assert.deepEqual(main.map((s) => s.label), LABELS);
  assert.deepEqual(main.map((s) => s.id), DEMO.map((s) => s.id));
  assert.equal(more.length, 0);
});

test('an exact id beats a look-alike: trending-in-rpg goes to more', () => {
  const { main, more } = splitSorts([{ id: 'trending-in-rpg', name: 'Trending in RPG' }, { id: 'top-trending', name: 'Top Trending' }]);
  assert.deepEqual(main.map((s) => s.id), ['top-trending']);
  assert.deepEqual(more.map((s) => [s.id, s.label]), [['trending-in-rpg', 'Trending in RPG']]);
});

test('with no top-trending id the name Trending is the fallback', () => {
  const { main, more } = splitSorts([{ id: 'x1', name: 'Trending' }, { id: 'x2', name: 'Trending in RPG' }]);
  assert.deepEqual(main.map((s) => [s.id, s.label]), [['x1', 'Trending']]);
  assert.deepEqual(more.map((s) => s.id), ['x2']);
});

test('the id pass runs over all six before any name fallback', () => {
  const { main } = splitSorts([{ id: 'zz', name: 'Top Earning' }, { id: 'top-earning', name: 'Something else' }]);
  assert.deepEqual(main.map((s) => s.id), ['top-earning']);
});

test('missing lists are skipped and empty input is safe', () => {
  const { main } = splitSorts([DEMO[5], DEMO[1]]);
  assert.deepEqual(main.map((s) => s.label), ['Up and coming', 'Top earning']);
  assert.deepEqual(splitSorts(undefined), { main: [], more: [] });
});

test('more keeps the input order', () => {
  const extra = [{ id: 'c', name: 'C' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const { more } = splitSorts([extra[0], DEMO[0], extra[1], extra[2]]);
  assert.deepEqual(more.map((s) => s.id), ['c', 'a', 'b']);
});
