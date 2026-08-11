#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'CoachTools.zip');
const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const EXCLUDED_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep']);
const REQUIRED_DIRECTORY_ENTRIES = ['CoachTools/graphics/', 'CoachTools/storage/'];

const allStarBuild = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'allstar', 'build', 'build-portable.js')], { stdio: 'inherit' });
if (allStarBuild.status !== 0) process.exit(allStarBuild.status || 1);

const validation = spawnSync(process.execPath, [path.join(__dirname, 'validate-suite.js')], { stdio: 'inherit' });
if (validation.status !== 0) process.exit(validation.status || 1);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && (EXCLUDED_DIRS.has(entry.name) || full === OUT_DIR)) continue;
    if (entry.isFile() && (EXCLUDED_FILES.has(entry.name) || /~$|\.tmp$/i.test(entry.name))) continue;
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const localParts = [];
const centralParts = [];
let offset = 0;
let count = 0;

function addEntry(archiveName, data, modifiedAt, directory = false) {
  const compressed = directory ? data : zlib.deflateRawSync(data, { level: 9 });
  const useCompression = !directory && compressed.length < data.length;
  const payload = useCompression ? compressed : data;
  const method = useCompression ? 8 : 0;
  const name = Buffer.from(archiveName, 'utf8');
  const crc = crc32(data);
  const stamp = dosDateTime(modifiedAt);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(stamp.time, 10);
  local.writeUInt16LE(stamp.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, name, payload);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(stamp.time, 12);
  central.writeUInt16LE(stamp.date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(directory ? 0x10 : 0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);

  offset += local.length + name.length + payload.length;
  count += 1;
}

const packageTime = new Date();
for (const directory of REQUIRED_DIRECTORY_ENTRIES) addEntry(directory, Buffer.alloc(0), packageTime, true);

for (const file of walk(ROOT).sort()) {
  const stat = fs.statSync(file);
  const archiveName = 'CoachTools/' + path.relative(ROOT, file).split(path.sep).join('/');
  addEntry(archiveName, fs.readFileSync(file), stat.mtime);
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(count, 8);
end.writeUInt16LE(count, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, Buffer.concat([...localParts, centralDirectory, end]));
console.log(`Created ${OUT_FILE} (${count} files, ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB).`);
