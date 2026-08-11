#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STORAGE_ROOT = path.join(ROOT, 'storage');
const HOST = '127.0.0.1';
const requestedPort = Number(process.env.COACHTOOLS_PORT || process.argv[2] || 4173);
const SUPPORTED_STORAGE_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function openBrowser(url) {
  if (process.env.COACHTOOLS_NO_OPEN === '1') return;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) {}
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(value));
}

function supportedStorageFiles() {
  if (!fs.existsSync(STORAGE_ROOT)) return [];
  return fs.readdirSync(STORAGE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && SUPPORTED_STORAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => {
      const filePath = path.join(STORAGE_ROOT, entry.name);
      const stat = fs.statSync(filePath);
      return {
        filename: entry.name,
        extension: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        modifiedTime: stat.mtime.toISOString(),
        url: '/storage/' + encodeURIComponent(entry.name)
      };
    })
    .sort((left, right) => Date.parse(right.modifiedTime) - Date.parse(left.modifiedTime) || left.filename.localeCompare(right.filename));
}

function isSafeStorageFile(filePath) {
  return path.dirname(filePath) === STORAGE_ROOT && SUPPORTED_STORAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function sendFile(request, response, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  try {
    const rawTarget = String(request.url || '/');
    const rawPath = rawTarget.split(/[?#]/, 1)[0];
    const url = new URL(rawTarget, `http://${HOST}`);
    if (url.pathname === '/api/storage') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }).end('Method not allowed');
        return;
      }
      const payload = { available: true, supportedExtensions: Array.from(SUPPORTED_STORAGE_EXTENSIONS), files: supportedStorageFiles() };
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end();
      } else sendJson(response, 200, payload);
      return;
    }
    if (rawPath === '/storage' || rawPath.startsWith('/storage/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }).end('Method not allowed');
        return;
      }
      let fileName = '';
      try { fileName = decodeURIComponent(rawPath.slice('/storage/'.length)); }
      catch (_) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad request');
        return;
      }
      if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\') || path.basename(fileName) !== fileName) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const storageFile = path.join(STORAGE_ROOT, fileName);
      if (!isSafeStorageFile(storageFile)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      sendFile(request, response, storageFile);
      return;
    }
    const decoded = decodeURIComponent(url.pathname);
    const requestPath = decoded === '/' ? '/index.html' : decoded;
    let filePath = path.resolve(ROOT, '.' + requestPath);
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (filePath.startsWith(STORAGE_ROOT + path.sep) && !isSafeStorageFile(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
    sendFile(request, response, filePath);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error.message || error));
  }
});

server.listen(Number.isFinite(requestedPort) ? requestedPort : 4173, HOST, () => {
  const address = server.address();
  const url = `http://${HOST}:${address.port}/`;
  console.log(`CoachTools is running at ${url}`);
  console.log('Keep this window open while using CoachTools. Press Ctrl+C to stop.');
  openBrowser(url);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
