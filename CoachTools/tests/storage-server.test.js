#!/usr/bin/env node
'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(root, 'build', 'start-local-server.js'), '0'], {
  cwd: root,
  env: { ...process.env, COACHTOOLS_NO_OPEN: '1', COACHTOOLS_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let port = null;

function request(requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port, path: requestPath, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    call.on('error', reject);
    call.end();
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local server did not start.')), 5000);
    child.stdout.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match) return;
      clearTimeout(timer);
      port = Number(match[1]);
      resolve();
    });
    child.stderr.on('data', chunk => reject(new Error(String(chunk))));
    child.on('exit', code => {
      if (port == null) reject(new Error(`Local server exited early with code ${code}.`));
    });
  });
}

(async () => {
  try {
    await waitForServer();
    const listingResponse = await request('/api/storage');
    assert.strictEqual(listingResponse.status, 200);
    const listing = JSON.parse(listingResponse.body);
    assert.strictEqual(listing.available, true);
    assert.deepStrictEqual(listing.supportedExtensions.sort(), ['.csv', '.xls', '.xlsx']);
    for (const file of listing.files) {
      assert(['.csv', '.xls', '.xlsx'].includes(file.extension));
      assert(/^\/storage\/[^/]+$/.test(file.url));
      assert(!file.url.includes('..'));
    }
    assert.strictEqual((await request('/api/storage', 'POST')).status, 405);
    assert.strictEqual((await request('/storage/../README.md')).status, 404);
    assert.strictEqual((await request('/storage/%2e%2e%2fREADME.md')).status, 404);
    assert.strictEqual((await request('/storage/.gitkeep')).status, 404);
    console.log('CoachTools storage server safety tests passed.');
  } finally {
    child.kill('SIGINT');
  }
})().catch(error => {
  console.error(error);
  child.kill('SIGINT');
  process.exit(1);
});
