'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const patchPath = path.join(root, 'build', 'performance-scorecard-ranking-patch.txt');
const testPath = path.join(root, 'tests', 'performance-scorecard-ranking.test.js');

let patch = fs.readFileSync(patchPath, 'utf8');

const oldSanitizer = /function installExportSafeCloneStyles\(doc\)\{[^\n]*\}/;
if (!oldSanitizer.test(patch)) throw new Error('Could not find export clone sanitizer.');

const newSanitizer = `function installExportSafeCloneStyles(doc){const body=doc.body,vars={'--goal-good-bg':'var(--panel2)','--goal-bad-bg':'var(--panel2)','--goal-good-hover':'var(--panel2)','--goal-bad-hover':'var(--panel2)','--row-hover-bg':'var(--panel2)','--active-bg':'var(--panel2)'},hadClass=Boolean(body?.classList.contains('scorecardExportSafe')),previous=[];if(body){body.classList.add('scorecardExportSafe');for(const [name,value] of Object.entries(vars)){previous.push([name,body.style.getPropertyValue(name),body.style.getPropertyPriority(name)]);body.style.setProperty(name,value,'important')}}const style=doc.createElement('style');style.dataset.scorecardExportSafe='true';style.textContent=\`body.scorecardExportSafe .main .summary.metric:after{display:none!important;background:none!important}body.scorecardExportSafe .main .metricCell.goalMet{background:var(--panel2)!important;box-shadow:inset 0 0 0 2px var(--good)!important}body.scorecardExportSafe .main .metricCell.goalMiss{background:var(--panel2)!important;box-shadow:inset 0 0 0 2px var(--bad)!important}body.scorecardExportSafe .main .quickFilter.active{background:var(--panel2)!important;border-color:var(--accent)!important;color:var(--accent)!important}body.scorecardExportSafe .main .statusBadge.strong,body.scorecardExportSafe .main .statusBadge.healthy{background:var(--panel2)!important;border-color:var(--good)!important;color:var(--good)!important}body.scorecardExportSafe .main .statusBadge.watch{background:var(--panel2)!important;border-color:var(--warn)!important;color:var(--warn)!important}body.scorecardExportSafe .main .statusBadge.attention{background:var(--panel2)!important;border-color:var(--bad)!important;color:var(--bad)!important}body.scorecardExportSafe .main .statusBadge.building{background:var(--panel2)!important;border-color:var(--accent3)!important;color:var(--accent3)!important}\`;doc.head.appendChild(style);return()=>{style.remove();if(!body)return;if(!hadClass)body.classList.remove('scorecardExportSafe');for(const [name,value,priority] of previous){if(value)body.style.setProperty(name,value,priority);else body.style.removeProperty(name)}}}`;

patch = patch.replace(oldSanitizer, newSanitizer);

const capturePattern = /async function captureScorecardCanvas\(\)\{[^\n]*\}/;
const captureMatch = patch.match(capturePattern);
if (!captureMatch) throw new Error('Could not find scorecard capture function.');
let capture = captureMatch[0];
if (!capture.includes('return window.html2canvas(target,')) throw new Error('Unexpected scorecard capture implementation.');

capture = capture.replace(
  'return window.html2canvas(target,',
  'const restoreExportStyles=installExportSafeCloneStyles(document);try{return await window.html2canvas(target,'
);
if (!capture.endsWith(')}})}')) throw new Error('Unexpected scorecard capture tail.');
capture = `${capture.slice(0, -1)}finally{restoreExportStyles()}}`;
patch = patch.replace(capturePattern, capture);

fs.writeFileSync(patchPath, patch, 'utf8');

let test = fs.readFileSync(testPath, 'utf8');
const anchor = "assert.ok(enhanced.includes('function installExportSafeCloneStyles(doc)'), 'scorecard export should sanitize unsupported CSS color functions in the clone');";
if (!test.includes(anchor)) throw new Error('Could not find export sanitizer test anchor.');
const additions = `${anchor}\nassert.ok(enhanced.includes('installExportSafeCloneStyles(document)'), 'scorecard export should apply safe colors before html2canvas starts cloning');\nassert.ok(enhanced.includes('finally{restoreExportStyles()}'), 'live export-safe styles should always be restored after capture');`;
test = test.replace(anchor, additions);
fs.writeFileSync(testPath, test, 'utf8');

console.log('Patched Performance Scorecard export to sanitize live computed styles before cloning.');
