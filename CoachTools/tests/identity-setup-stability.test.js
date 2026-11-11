'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const idb = require('fake-indexeddb');

async function setup() {
  const values = new Map(), handlers = new Map(), events = [];
  const context = vm.createContext({
    ...idb, indexedDB: new idb.IDBFactory(), console, setTimeout, clearTimeout,
    queueMicrotask, structuredClone,
    // Control the saved setup sync explicitly instead of running its idle job.
    requestIdleCallback() { return 1; },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    dispatchEvent(event) { for (const handler of handlers.get(event.type) || []) handler(event); },
    CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; }
  });
  context.window = context;
  context.parent = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../shared/coachtools-identity.js'), 'utf8'), context);
  const identity = context.CoachToolsIdentity;
  await identity.ready();
  identity.subscribe(detail => events.push(detail));
  return {identity, events, values};
}

const teamSetup = {
  groups: {
    team: [{name: 'Retail East', members: ['Coach Alpha', 'Coach Beta', 'Coach Gamma']}],
    coord: [{name: 'Coordinator Example', members: ['Coach Alpha', 'Coach Beta', 'Coach Gamma']}]
  }
};
const plain = value => JSON.parse(JSON.stringify(value));

test('reopening an unchanged saved team setup does not revise people or notify scoped tools again', async () => {
  const {identity, events, values} = await setup();
  values.set('myone.master.v2.setup', JSON.stringify(teamSetup));
  await identity.syncTeamSetup();
  assert.deepEqual(events.map(event => event.reason), ['team-setup-synced'], 'one completed setup notifies consumers once');
  const before = plain(await identity.getAllPeople()), version = identity.getIdentityVersion();
  assert.equal(before.length, 3);
  assert.ok(before.every(person => person.currentTeam === 'Retail East' && person.coordinator === 'Coordinator Example'));
  events.length = 0;
  const updated = await identity.syncTeamSetup();
  assert.equal(updated, 0, 'a repeated setup does not contain changed assignments');
  assert.equal(identity.getIdentityVersion(), version, 'unchanged setup must not invalidate a completed scope');
  assert.deepEqual(events, [], 'unchanged setup must not restart connected tools');
  assert.deepEqual(plain(await identity.getAllPeople()), before, 'timestamps, aliases and assignment histories stay unchanged');
});

test('a real team assignment change remains visible and the next unchanged replay stays quiet', async () => {
  const {identity, events} = await setup();
  await identity.syncTeamSetup(teamSetup);
  const alpha = (await identity.resolveName('Coach Alpha')).person;
  const version = identity.getIdentityVersion();
  events.length = 0;
  const changed = {groups: {team: [{name: 'Retail West', members: ['Coach Alpha']}], coord: []}};
  assert.ok(await identity.syncTeamSetup(changed) > 0);
  assert.ok(identity.getIdentityVersion() > version);
  assert.deepEqual(events.map(event => event.reason), ['team-setup-synced'], 'changed assignments notify consumers once after completion');
  const moved = await identity.getPerson(alpha.personId);
  assert.equal(moved.currentTeam, 'Retail West');
  assert.ok(moved.teamHistory.some(entry => entry.team === 'Retail East' && entry.to));
  assert.ok(moved.teamHistory.some(entry => entry.team === 'Retail West' && !entry.to));
  events.length = 0;
  const finalVersion = identity.getIdentityVersion();
  assert.equal(await identity.syncTeamSetup(changed), 0);
  assert.equal(identity.getIdentityVersion(), finalVersion);
  assert.deepEqual(events, []);
});

test('unchanged person edits stay quiet while new coordinator and source evidence remain meaningful', async () => {
  const {identity, events} = await setup();
  await identity.syncTeamSetup(teamSetup);
  const alpha = (await identity.resolveName('Coach Alpha')).person;
  events.length = 0;
  const version = identity.getIdentityVersion();
  const same = await identity.updatePerson(alpha.personId, {currentTeam: 'Retail East', coordinator: 'Coordinator Example'});
  assert.equal(identity.getIdentityVersion(), version);
  assert.equal(same.updatedAt, alpha.updatedAt, 'a skipped write does not return a fictitious new timestamp');
  assert.deepEqual(events, []);
  await identity.syncTeamSetup({groups: {coord: [{name: 'Coordinator New', members: ['Coach Alpha']}]}});
  assert.equal((await identity.getPerson(alpha.personId)).coordinator, 'Coordinator New');
  assert.deepEqual(events.map(event => event.reason), ['team-setup-synced']);
  const beforeObservation = identity.getIdentityVersion();
  await identity.learn('Coach Alpha', {role: 'coach', source: 'new-import-evidence'});
  assert.ok(identity.getIdentityVersion() > beforeObservation, 'a newly observed source is retained');
  assert.deepEqual(plain((await identity.getPerson(alpha.personId)).sourceNames['new-import-evidence']), ['Coach Alpha']);
  const afterObservation = identity.getIdentityVersion();
  await identity.learn('Coach Alpha', {role: 'coach', source: 'new-import-evidence'});
  assert.equal(identity.getIdentityVersion(), afterObservation, 'repeated identical evidence does not invalidate scopes');
});

test('a later setup write failure notifies committed assignments once and still rejects', async () => {
  const {identity, events} = await setup();
  for (const name of ['Coach Alpha', 'Coach Beta', 'Coach Gamma']) await identity.learn(name, {role: 'coach', source: 'fixture'});
  const before = plain(await identity.getAllPeople()), originalPut = idb.IDBObjectStore.prototype.put;
  const failure = Object.assign(new Error('The second setup transaction could not persist.'), {name: 'QuotaExceededError'});
  idb.IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name === 'coachtoolsPeople' && value.displayName === 'Coach Beta') throw failure;
    return originalPut.call(this, value, ...args);
  };
  try {
    await assert.rejects(identity.syncTeamSetup(teamSetup), error => error === failure);
  } finally {
    idb.IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(events.map(event => [event.reason, event.updated]), [['team-setup-partial', 1]], 'the committed membership cannot be hidden by a later failure');
  const after = plain(await identity.getAllPeople());
  assert.equal(after.find(person => person.displayName === 'Coach Alpha').currentTeam, 'Retail East');
  for (const name of ['Coach Beta', 'Coach Gamma']) assert.deepEqual(after.find(person => person.displayName === name), before.find(person => person.displayName === name));
  events.length = 0;
  assert.equal(await identity.syncTeamSetup(teamSetup), 3, 'retry fills remaining team/coordinator fields without losing the first commit');
  assert.deepEqual(events.map(event => event.reason), ['team-setup-synced']);
  events.length = 0;
  assert.equal(await identity.syncTeamSetup(teamSetup), 0);
  assert.deepEqual(events, [], 'completed unchanged retry remains quiet');
});

test('a setup failure before any commit does not publish a fictitious membership change', async () => {
  const {identity, events} = await setup(), originalPut = idb.IDBObjectStore.prototype.put;
  const failure = new Error('No setup write could commit.');
  idb.IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name === 'coachtoolsPeople') throw failure;
    return originalPut.call(this, value, ...args);
  };
  try {
    await assert.rejects(identity.syncTeamSetup(teamSetup), error => error === failure);
  } finally {
    idb.IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(events, []);
  assert.deepEqual(plain(await identity.getAllPeople()), []);
});
