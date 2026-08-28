'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'shared', 'performance-scorecard-goals.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'apps', 'performance-scorecard-enhanced.html'), 'utf8');

function loadService(initial = {}) {
  const stored = new Map(Object.entries(initial));
  const events = [];
  const context = {
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, value); }
    },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    dispatchEvent(event) { events.push(event); }
  };
  vm.runInNewContext(source, context);
  return { service: context.CoachToolsPerformanceScorecardGoals, stored, events };
}

test('shared goals persist, format percentages, and support lower-is-better', () => {
  const { service, stored, events } = loadService();
  assert.equal(service.definition('consumer').goal, 0.47);
  assert.equal(service.inputValue('consumer-rate'), '47');
  assert.equal(service.fromInput('consumer-rate', '52'), 0.52);
  service.set('consumer', { goal: 0.52 });
  assert.equal(service.format('consumer-rate'), '52.0%');
  assert.equal(service.evaluate('consumer-rate', 0.51), 'opportunity');
  service.set('open-checklist', { goal: 1, direction: 'lower' });
  assert.equal(service.evaluate('open-checklist', 1), 'success');
  assert.equal(service.evaluate('open-checklist', 2), 'opportunity');
  assert.ok(stored.get(service.STORAGE_KEY).includes('consumer-rate'));
  assert.ok(events.some(event => event.detail.id === 'consumer-rate'));
});

test('shared goal reset restores canonical defaults', () => {
  const { service } = loadService();
  service.set('call-quality', { goal: 0.9, direction: 'lower' });
  service.reset('call-quality');
  assert.equal(service.definition('call-quality').goal, 0.85);
  assert.equal(service.definition('call-quality').direction, 'higher');
});

test('scorecard integrates shared goals into cells and the Columns & Goals drawer', () => {
  assert.match(html, /performance-scorecard-goals\.js/);
  assert.match(html, /Columns &amp; Goals/);
  assert.match(html, /data-goal-input/);
  assert.match(html, /data-goal-direction/);
  assert.match(html, /Reset Goals to Defaults/);
  assert.match(html, /goalCellAttrs/);
  assert.match(html, /refreshGoalPresentation/);
});
