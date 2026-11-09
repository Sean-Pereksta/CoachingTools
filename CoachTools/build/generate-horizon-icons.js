#!/usr/bin/env node
'use strict';

// A small, reproducible icon family for the Horizon desktop. No remote assets,
// fonts, or raster dependencies are needed at runtime.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'icons/horizon');
const cream = '#fff2d9';
const amber = '#efb96b';
const accent = (d, other = '') => `<path d="${d}" stroke="${amber}" ${other}/>`;
const star = '<path d="m64 29 10.2 20.7 22.8 3.3-16.5 16.1 3.9 22.7L64 81.1 43.6 91.8l3.9-22.7L31 53l22.8-3.3Z"/>';
const folder = badge => `<path d="M27 44v-7a7 7 0 0 1 7-7h20l11 12h28a8 8 0 0 1 8 8v39a8 8 0 0 1-8 8H35a8 8 0 0 1-8-8V44Z"/><path d="M28 51h72" opacity=".4"/>${badge}`;
const icons = {
  allstar: ['All-Star Report', star + accent('m56 62 6 6 13-14')],
  'verification-all-star': ['Verification All Star', '<path d="m55 27 9.3 19 21 3-15.2 14.8 3.6 20.9L55 74.9 36.3 84.7 39.9 63.8 24.7 49l21-3Z"/><path d="M89 64 108 71v13c0 12-9 20-19 24-10-4-19-12-19-24V71Z" fill="#173b3f"/>' + accent('m80 84 6 6 13-14')],
  'weekly-data': ['Data Manager', '<ellipse cx="64" cy="37" rx="29" ry="11"/><path d="M35 37v49c0 6 13 11 29 11s29-5 29-11V37M35 54c0 6 13 11 29 11s29-5 29-11M35 71c0 6 13 11 29 11s29-5 29-11"/>' + accent('M64 45v23m-8-8 8 8 8-8')],
  'people-profiles': ['People Profiles', '<circle cx="57" cy="44" r="14"/><path d="M30 92v-7c0-15 12-24 27-24s27 9 27 24v7Z"/>' + accent('M83 32a12 12 0 0 1 0 24m9 10c9 5 13 12 13 22v4')],
  'coaching-command-center': ['Coaching Command Center', '<circle cx="64" cy="63" r="30"/><circle cx="64" cy="63" r="17"/><circle cx="64" cy="63" r="4" fill="'+cream+'" stroke="none"/><path d="M64 25v11M64 90v11M26 63h11M91 63h11"/>' + accent('m64 63 24-24m-1-7 1 7 7 1')],
  'coaching-gaps': ['Coaching Gaps', '<path d="M29 33h29v24H29ZM70 33h29v24H70ZM29 69h29v24H29Z"/>' + accent('M84 69v24m-12-12h24')],
  'coach-timeline': ['Coach Timeline', '<path d="M30 38h69M30 64h69M30 90h69" opacity=".45"/><circle cx="42" cy="38" r="7" fill="#173b3f"/><circle cx="78" cy="64" r="7" fill="#173b3f"/><circle cx="59" cy="90" r="7" fill="#173b3f"/>' + accent('M49 38h20m16 26h14M30 90h22')],
  'kpi-impact': ['KPI Impact', '<path d="M30 30v67h70M43 83V67M59 83V56M75 83V42"/>' + accent('m40 56 18-15 14 4 25-20m-13 0h13v13')],
  'performance-scorecard': ['Performance Scorecard', '<rect x="31" y="27" width="66" height="76" rx="8"/><path d="M46 44h36M46 60h18M46 76h18M46 91h18"/>' + accent('m76 60 4 4 8-9m-12 22 4 4 8-9m-12 20 4 4 8-9')],
  'weekly-comparison': ['Weekly Comparison', '<path d="M29 52V29h26v23M73 99V76h26v23M29 66v33h26V66M73 62V29h26v33"/>' + accent('M31 60h20m24 9h20')],
  'qa-scores': ['QA Scores', '<path d="m64 27 31 12v23c0 20-14 34-31 41-17-7-31-21-31-41V39Z"/>' + accent('m47 64 12 12 24-28')],
  'audit-checklist': ['Audit and Checklist', '<path d="M48 30h-9a8 8 0 0 0-8 8v57a8 8 0 0 0 8 8h50a8 8 0 0 0 8-8V38a8 8 0 0 0-8-8h-9"/><rect x="48" y="24" width="32" height="15" rx="5"/><path d="M62 57h20M62 75h20M62 91h20"/>' + accent('m43 56 4 4 7-8m-11 22 4 4 7-8m-11 22 4 4 7-8')],
  'contact-center-checklist': ['Contact Center Checklist', '<path d="M33 66V55a31 31 0 0 1 62 0v11M33 61h7v24h-7a8 8 0 0 1-8-8v-8a8 8 0 0 1 8-8ZM95 61h-7v24h7a8 8 0 0 0 8-8v-8a8 8 0 0 0-8-8ZM95 85c0 11-13 15-24 15"/>' + accent('m50 61 10 10 20-22')],
  'video-library': ['Training Videos', '<rect x="27" y="32" width="74" height="64" rx="10"/>' + '<path d="m55 49 24 15-24 15Z" fill="'+amber+'" stroke="'+amber+'"/>'],
  'weekly-data-builder': ['Weekly Data Builder', '<path d="m33 41 31-15 31 15-31 15ZM33 61l31 15 31-15M33 81l31 15 31-15"/>' + accent('M64 56v20m0 8v12')],
  'all-star-tools': ['All Star Tools', folder('<path d="m64 59 5.4 11 12.1 1.8-8.8 8.5 2.1 12L64 86.6l-10.8 5.7 2.1-12-8.8-8.5L58.6 70Z" stroke="'+amber+'"/>')],
  'coach-analytics-tools': ['Coach Analytics Tools', folder(accent('M45 85V74m18 11V65m18 20V59'))],
  'general-apps': ['General Apps', folder('<rect x="45" y="62" width="13" height="12" rx="2"/><rect x="70" y="62" width="13" height="12" rx="2"/><rect x="45" y="82" width="13" height="8" rx="2"/><path d="M70 86h13" stroke="'+amber+'"/>')],
  'under-construction': ['Under Construction', folder(accent('m49 87 26-26m-2-2 12 12M42 80l12 12M73 59l10 2 2 10'))],
  'coachtools-home': ['Horizon Home', '<path d="m25 83 27-32 17 20 14-15 22 27"/><path d="M31 96h68"/>' + '<path d="M51 42a15 15 0 0 1 30 0" stroke="'+amber+'"/>'+accent('M66 20v-4M42 27l-4-4m52 4 4-4')],
  start: ['Start', '<path d="m25 83 27-32 17 20 14-15 22 27"/><path d="M31 96h68"/>' + '<path d="M51 42a15 15 0 0 1 30 0" stroke="'+amber+'"/>'+accent('M66 20v-4M42 27l-4-4m52 4 4-4')],
  'shared-data': ['Shared Data', '<circle cx="64" cy="37" r="12"/><circle cx="35" cy="88" r="12"/><circle cx="93" cy="88" r="12"/><path d="m58 48-17 29m29-29 17 29M47 88h34"/>' + accent('M64 61v12m-6-6h12')],
  'backup-restore': ['Backup and Restore', '<path d="M35 50a31 31 0 0 1 52-17l9 9M96 27v15H81M93 79a31 31 0 0 1-52 17l-9-9M32 102V87h15"/>' + accent('M64 47v34m-11-11 11 11 11-11')],
  settings: ['Settings', '<path d="M64 27v10M64 91v10M27 64h10M91 64h10M38 38l8 8M82 82l8 8M38 90l8-8M82 46l8-8"/><circle cx="64" cy="64" r="27"/><circle cx="64" cy="64" r="10" stroke="'+amber+'"/>'],
  'all-apps': ['All Applications', '<rect x="29" y="29" width="25" height="25" rx="5"/><rect x="74" y="29" width="25" height="25" rx="5"/><rect x="29" y="74" width="25" height="25" rx="5"/><rect x="74" y="74" width="25" height="25" rx="5" stroke="'+amber+'"/>'],
  'default-app': ['Application', '<rect x="29" y="29" width="70" height="70" rx="12"/><path d="M29 48h70"/>' + accent('M64 61v23m-11-11h22')]
};

function svg(id, [title, glyph]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-labelledby="title"><title id="title">${title}</title><defs><linearGradient id="tile" x2=".8" y2="1"><stop stop-color="#24464a"/><stop offset="1" stop-color="#092529"/></linearGradient><linearGradient id="rim" x2="1" y2="1"><stop stop-color="#d6c7a6" stop-opacity=".7"/><stop offset=".5" stop-color="#638182" stop-opacity=".35"/><stop offset="1" stop-color="#e9b775" stop-opacity=".75"/></linearGradient><radialGradient id="sun"><stop stop-color="#efb96b" stop-opacity=".18"/><stop offset="1" stop-color="#efb96b" stop-opacity="0"/></radialGradient></defs><rect x="3" y="3" width="122" height="122" rx="29" fill="#061b1f" opacity=".65"/><rect x="3.75" y="2.75" width="120.5" height="120.5" rx="28" fill="url(#tile)" stroke="url(#rim)" stroke-width="1.5"/><path d="M28 8h72" stroke="#e8ddc6" opacity=".1" stroke-linecap="round"/><ellipse cx="64" cy="115" rx="56" ry="25" fill="url(#sun)"/><path d="M24 112h80" stroke="#edba76" stroke-opacity=".16"/><g fill="none" stroke="${cream}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>\n`;
}
fs.mkdirSync(OUT, { recursive: true });
for (const [id, content] of Object.entries(icons)) fs.writeFileSync(path.join(OUT, id + '.svg'), svg(id, content));

// Install changes only when explicitly requested; routine regeneration leaves
// application source and manifest metadata untouched.
if (process.argv.includes('--install')) {
  const manifestPath = path.join(ROOT, 'apps.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const app of manifest.apps) {
    if (!icons[app.id]) throw new Error('Horizon icon missing for ' + app.id);
    app.icon = `icons/horizon/${app.id}.png`;
  }
  const updateMetadata = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['dist', 'node_modules', 'vendor'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) updateMetadata(file);
      else if (/\.html?$/i.test(file)) {
        let html = fs.readFileSync(file, 'utf8');
        const id = html.match(/<meta\s+name=["']coachtools-id["']\s+content=["']([^"']+)["'][^>]*>/i)?.[1];
        if (!id || !icons[id]) continue;
        const iconTag = `<meta name="coachtools-icon" content="icons/horizon/${id}.png" />`;
        if (/<meta\s+name=["']coachtools-icon["'][^>]*>/i.test(html)) html = html.replace(/<meta\s+name=["']coachtools-icon["'][^>]*>/i, iconTag);
        else html = html.replace(/(<meta\s+name=["']coachtools-id["'][^>]*>)/i, '$1\n' + iconTag);
        fs.writeFileSync(file, html);
      }
    }
  };
  updateMetadata(path.join(ROOT, 'apps'));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  execFileSync(process.execPath, [path.join(ROOT, 'build/generate-app-manifest.js')], { stdio: 'inherit' });
}
console.log(`Generated ${Object.keys(icons).length} Horizon icons.`);
