'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'apps', 'performance-scorecard.html');
const ENHANCED_PATH = path.join(ROOT, 'apps', 'performance-scorecard-enhanced.html');
const PATCH_PATH = path.join(__dirname, 'performance-scorecard-ranking-patch.txt');

function requiredReplace(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Could not patch ${label}.`);
  return next;
}

function rankingPatch() {
  if (fs.existsSync(PATCH_PATH)) return fs.readFileSync(PATCH_PATH, 'utf8').trim();

  // The first run migrates the ranking implementation out of the old runtime
  // loader. Keeping it in a separate text file makes future static rebuilds
  // deterministic and avoids ever fetching HTML from file:// at runtime.
  const current = fs.readFileSync(ENHANCED_PATH, 'utf8');
  const match = current.match(/<script\s+type=["']text\/plain["']\s+id=["']rankingPatch["']>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Could not recover the ranking patch from the existing enhanced scorecard.');
  const patch = match[1].trim();
  fs.writeFileSync(PATCH_PATH, `${patch}\n`, 'utf8');
  return patch;
}

let source = fs.readFileSync(SOURCE_PATH, 'utf8');
const patch = rankingPatch();

source = requiredReplace(
  source,
  /(<meta name="coachtools-id" content="performance-scorecard" \/>)/,
  '$1\n<meta name="coachtools-hidden" content="true" />',
  'hidden app metadata'
);
source = source.replace(
  /<meta name="coachtools-version" content="[^"]+" \/>/,
  '<meta name="coachtools-version" content="1.9" />'
);
source = requiredReplace(
  source,
  /function teamCohortFor\(rep\)\{[^\n]*\}/,
  'function teamCohortFor(){return scopedReps()}',
  'scope-relative percentile cohort'
);
source = requiredReplace(
  source,
  /function percentile\(value,values,higher=true\)\{[^\n]*\}/,
  'function percentile(value,values,higher=true){const v=values.filter(Number.isFinite);if(!Number.isFinite(value)||!v.length)return null;if(v.length===1)return 100;const less=v.filter(x=>x<value).length,equal=v.filter(x=>x===value).length,position=less+Math.max(0,equal-1)/2;let p=position/(v.length-1);if(!higher)p=1-p;return Math.round(clamp(p,0,1)*100)}',
  'scope percentile calculation'
);
source = requiredReplace(
  source,
  /function getRows\(\)\{[^\n]*\}/,
  "function getRows(){const reps=scopedReps(),rows=reps.map(r=>rowData(r,reps)),k=state.sort.key,d=state.sort.dir;if(k==='rank-overall'||k==='rank-score'||String(k).startsWith('rank:'))return rows;rows.sort((a,b)=>{let av=sortValue(a,k),bv=sortValue(b,k);if(typeof av==='string')return av.localeCompare(String(bv))*d;if(!Number.isFinite(av))av=d>0?Infinity:-Infinity;if(!Number.isFinite(bv))bv=d>0?Infinity:-Infinity;return(av-bv)*d});return rows}",
  'scope-relative scorecard rows'
);
source = source
  .split('team percentiles').join('scope percentiles')
  .split('team percentile').join('scope percentile')
  .split('Insufficient team cohort').join('Insufficient scope cohort')
  .split('P${p.percentile} on team').join('P${p.percentile} in scope');

const marker = "window.addEventListener('error',e=>console.error('[Performance Scorecard]',e.error||e.message));";
source = requiredReplace(source, marker, `${patch}\n${marker}`, 'ranking scorecard');

if (/\bfetch\s*\(\s*SOURCE\b|new\s+XMLHttpRequest\s*\(/.test(source)) {
  throw new Error('Generated scorecard still contains the local HTML runtime loader.');
}

fs.writeFileSync(ENHANCED_PATH, source, 'utf8');
console.log(`Generated static enhanced scorecard: ${path.relative(ROOT, ENHANCED_PATH)}`);
