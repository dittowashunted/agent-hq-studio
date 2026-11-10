import test from 'node:test';
import assert from 'node:assert/strict';
import { isArtTask, routeEngine } from '../art-routing.mjs';

test('isArtTask hits art work and misses code work', () => {
  assert.ok(isArtTask({ title: 'Make 3 thumbnails' }));
  assert.ok(isArtTask({ title: 'new game icon' }));
  assert.ok(isArtTask({ title: 'x', body: 'Need key art for the store page' }));
  assert.ok(!isArtTask({ title: 'fix the server timer', body: 'It restarts on rejoin.' }));
  assert.ok(!isArtTask({ title: 'add a retry loop' }));
});

test('routeEngine sends art to antigravity only when allowed', () => {
  const on = { artAutoRoute: true, laneSchedules: { antigravity: { enabled: true } } };
  assert.equal(routeEngine({ title: 'Make 3 thumbnails', role: 'ui' }, on), 'antigravity');
  assert.equal(routeEngine({ title: 'Make 3 thumbnails', role: 'ui', engine: 'app' }, { ...on, artAutoRoute: false }), 'app');
  assert.equal(routeEngine({ title: 'icon', role: 'ui', engine: 'app' }, { ...on, laneSchedules: { antigravity: { enabled: false } } }), 'app');
  assert.equal(routeEngine({ title: 'fix the timer', role: 'builder', engine: 'app' }, on), 'app');
  assert.equal(routeEngine({ title: 'Fix icon spacing', role: 'builder' }, on), undefined);
  assert.equal(routeEngine({ title: 'Plan it', role: 'lead', body: 'icon art too' }, on), undefined);
});
