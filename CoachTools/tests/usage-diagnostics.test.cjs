const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../usage-diagnostics.html'), 'utf8');

function harness() {
  const elements = new Map();
  const calls = [];
  const context = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, { get(target, key) { return target[key] || ((...args) => calls.push([key, ...args])); }, set(target, key, value) { target[key] = value; return true; } });
  function element(id = '') {
    const el = { id, value: id === 'rangeDays' ? '30' : '', style: {}, children: [], events: {}, attributes: {}, hidden: false, width: 600, height: 330,
      classList: { toggle() {} }, appendChild(child) { this.children = this.children.filter(item => item !== child); this.children.push(child); return child; },
      append(...children) { children.forEach(child => this.appendChild(child)); }, replaceChildren(...children) { this.children = []; this.append(...children); },
      addEventListener(name, handler) { this.events[name] = handler; }, setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect() { return { left: 0, top: 0, width: this.cssWidth || 600, height: 330 }; }, getContext() { return context; },
      closest() { return { querySelectorAll: () => headers }; }
    };
    return el;
  }
  const headers = Array.from({ length: 9 }, (_, i) => Object.assign(element(), { textContent: `Column ${i}` }));
  const document = { readyState: 'loading', body: element(), createElement: () => element(), createTextNode: text => ({ textContent: text }), getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); } };
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-06T12:00:00'])); } }
  const sandbox = { document, Date: FixedDate, window: { addEventListener() {}, devicePixelRatio: 2 }, innerWidth: 1200, innerHeight: 800, requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {}, console };
  let script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  script = script.replace("      if (document.readyState === 'complete') start();", `      globalThis.api = { dailySeries, drawAppDailyChart, drawVisitorChart, drawAppChart, fetchAppDaily, charts, tooltip, setupInteractions, sortRows, renderDiagnostics, setDb: value => db = value, setPayload: value => lastPayload = value };
      if (document.readyState === 'complete') start();`);
  vm.runInNewContext(script, sandbox);
  return { api: sandbox.api, elements, calls, document, headers };
}
const records = [
  { date: '2026-10-04', appId: 'a', name: 'Alpha', opens: 27 },
  { date: '2026-10-06', appId: 'a', name: 'Alpha', opens: 17 },
  { date: '2026-10-06', appId: 'b', name: 'Beta', opens: 9 }
];
const apps = [{ appId: 'a', name: 'Alpha', opens: 1482 }, { appId: 'b', name: 'Beta', opens: 40 }, { appId: 'old', name: 'Lifetime only', opens: 2000 }];

test('daily counts remain exact and unknown history stays null, never lifetime-derived', () => {
  const { api } = harness(); const { dates, series } = api.dailySeries(records, apps, 14);
  const a = series.find(item => item.app.appId === 'a');
  assert.equal(a.values[dates.indexOf('2026-10-04')], 27);
  assert.equal(a.values[dates.indexOf('2026-10-06')], 17);
  assert.equal(a.values[dates.indexOf('2026-10-05')], null);
  assert.equal(a.total, 44);
  assert.ok(series.find(item => item.app.appId === 'old').values.every(value => value === null));
  assert.equal(dates.length, 14);
});

test('complete range query retains more than 10,000 counters and deduplicates oldest record', async () => {
  const { api } = harness(); const queries = [];
  const docs = Array.from({ length: 10005 }, (_, i) => ({ id: String(i), data: () => ({ date: '2026-10-06', appId: `app-${i}`, opens: i }) }));
  api.setDb({ collection(name) {
    assert.equal(name, 'coachtoolsUsageAppDaily');
    function chain(query = []) { return {
      where(...args) { return chain([...query, ['where', ...args]]); },
      orderBy(...args) { return chain([...query, ['orderBy', ...args]]); },
      limit(...args) { return chain([...query, ['limit', ...args]]); },
      async get() { queries.push(query); return { docs: query.some(item => item[0] === 'limit') ? [docs[0]] : docs }; }
    }; } return chain();
  } });
  const data = await api.fetchAppDaily();
  assert.equal(data.length, 10005);
  assert.equal(queries[0].some(item => item[0] === 'limit'), false);
  assert.ok(queries[0].some(item => item[0] === 'where' && item[2] === '>='));
});

test('daily read failures propagate instead of appearing as an empty successful result', async () => {
  const { api } = harness(); const chain = { where() { return this; }, orderBy() { return this; }, limit() { return this; }, get() { return Promise.reject(new Error('offline')); } };
  api.setDb({ collection: () => chain }); await assert.rejects(api.fetchAppDaily(), /offline/);
});

test('hover shows authoritative date counts and resizing preserves hit testing', () => {
  const { api, document } = harness(); api.setupInteractions();
  api.drawAppDailyChart(records, apps, 30);
  const canvas = document.getElementById('appDailyChart');
  canvas.events.pointermove({ clientX: 570, clientY: 100 });
  assert.equal(api.tooltip.children[0].textContent, 'October 6, 2026');
  assert.ok(api.tooltip.children.some(item => item.textContent === 'Alpha — 17 opens'));
  assert.ok(api.tooltip.children.some(item => item.textContent === 'Beta — 9 opens'));
  canvas.cssWidth = 250; api.drawAppDailyChart(records, apps, 30);
  canvas.events.pointermove({ clientX: 220, clientY: 100 });
  assert.equal(api.tooltip.children[0].textContent, 'October 6, 2026');
  assert.equal(canvas.width, 500);
  canvas.events.pointerleave(); assert.equal(api.tooltip.hidden, true);
});

test('legend selection changes geometry without changing records; lifetime chart includes all apps', () => {
  const { api, document } = harness(); api.setupInteractions();
  const original = JSON.stringify(records); api.drawAppDailyChart(records, apps, 30);
  const chip = document.getElementById('appLegend').children[0]; chip.events.click();
  assert.ok(api.charts.get('appDailyChart').points.every(point => point.appId !== 'a'));
  assert.equal(JSON.stringify(records), original);
  api.drawAppChart(apps); assert.equal(api.charts.get('appChart').bars.length, 3);
  document.getElementById('appChart').events.pointermove({ clientX: 250, clientY: 60 });
  assert.ok(api.tooltip.children.some(item => item.textContent === '1,482 lifetime opens'));
});

test('table sort uses numeric values rather than formatted strings and retains zero values', () => {
  const { api, document } = harness();
  const body = document.getElementById('appRows');
  body.children = ['0.0', '1,482', '40', 'Collecting'].map(text => ({ children: [{ textContent: 'App' }, { textContent: text }] }));
  api.sortRows(); assert.deepEqual(body.children.map(row => row.children[1].textContent), ['1,482', '40', '0.0', 'Collecting']);
});

test('existing diagnostic definitions preserve fixed fixture outputs', () => {
  const { api, document } = harness();
  api.renderDiagnostics({ summary: { appOpenEvents: 100 }, apps: [{ appId: 'a', name: 'Alpha', opens: 50 }, { appId: 'b', opens: 20 }], initials: [{ distinctApps: 4 }, { distinctApps: 1 }], daily: [{ date: '2026-10-06', appOpenEvents: 20, uniqueVisitors: 4 }, { date: '2026-09-28', appOpenEvents: 10, uniqueVisitors: 2 }] }, []);
  assert.equal(document.getElementById('sevenDayOpens').textContent, '20');
  assert.equal(document.getElementById('sevenDayOpensNote').textContent, '+100.0% vs the prior 7 calendar days.');
  assert.equal(document.getElementById('topThreeShare').textContent, '70.0%');
  assert.equal(document.getElementById('multiAppAdoption').textContent, '50.0%');
});

test('empty initial history recovers on refresh and one-day data has a visible point', () => {
  const { api } = harness(); api.drawAppDailyChart([], apps, 30);
  assert.equal(api.charts.has('appDailyChart'), false);
  api.drawAppDailyChart([records[1]], apps, 30);
  assert.equal(api.charts.get('appDailyChart').points.length, 1);
  assert.equal(api.charts.get('appDailyChart').points[0].value, 17);
});

test('visitor hover preserves exact anonymous visitor-day count', () => {
  const { api, document } = harness(); api.setupInteractions();
  api.drawVisitorChart([{ date: '2026-10-06', uniqueVisitors: 42 }]);
  document.getElementById('visitorChart').events.pointermove({ clientX: 570, clientY: 100 });
  assert.equal(api.tooltip.children[0].textContent, 'October 6, 2026');
  assert.equal(api.tooltip.children[1].textContent, '42 visitors');
});
