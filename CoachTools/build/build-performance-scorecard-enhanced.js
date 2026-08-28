'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'apps', 'performance-scorecard.html');
const ENHANCED_PATH = path.join(ROOT, 'apps', 'performance-scorecard-enhanced.html');
const PATCH_PATH = path.join(__dirname, 'performance-scorecard-ranking-patch.txt');
const EXTRA_STYLE_PATH = path.join(ROOT, 'shared', 'performance-scorecard-extras.css');

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
const extrasStyle = fs.readFileSync(EXTRA_STYLE_PATH, 'utf8').trim();

if (!/<meta name="coachtools-hidden" content="true" \/>/.test(source)) {
  source = requiredReplace(
    source,
    /(<meta name="coachtools-id" content="performance-scorecard" \/>)/,
    '$1\n<meta name="coachtools-hidden" content="true" />',
    'hidden app metadata'
  );
}
source = source.replace(
  /<meta name="coachtools-version" content="[^"]+" \/>/,
  '<meta name="coachtools-version" content="2.0" />'
);

// Keep the expensive rolling-window scan out of the hot row-building path.
// These helpers are module-local in the generated static page and are cleared
// whenever the scorecard calculation cache is invalidated.
if (!source.includes('let scorecardWindowMemo=null;')) {
  source = requiredReplace(source, /(const DATA_LOAD_OPTIONS = Object\.freeze\([^\n]+\);)/, "$1\nlet scorecardWindowMemo=null;\nconst latestBusinessWeekMemo=new Map();", 'scorecard window memo state');
  source = requiredReplace(source, /function resetCalcCache\(\)\{[^\n]*\}/, 'function resetCalcCache(){state.calcCache.clear();state.cohortCache.clear();scorecardWindowMemo=null;latestBusinessWeekMemo.clear()}', 'scorecard cache invalidation');
  source = requiredReplace(source, /function latestBusinessWeekKey\(\)\{[^\n]*\}/, "function latestBusinessWeekKey(){const department=$('departmentSel')?.value||'All';if(latestBusinessWeekMemo.has(department))return latestBusinessWeekMemo.get(department);let latest='';for(const points of state.weeklyByRep.values())for(const point of points||[]){if(department==='Retail'&&point.type!=='weeklyRetail')continue;if(department==='Referral'&&point.type!=='weeklyReferral')continue;const key=clean(point.week||point.sort||weekKey(point.date));if(key&&key>latest)latest=key}latestBusinessWeekMemo.set(department,latest);return latest}", 'latest business week memoization');
  source = requiredReplace(source, /function mainWindowSpec\(\)\{[^\n]*\}/, "function mainWindowSpec(){const mode=$('windowSel').value,department=$('departmentSel')?.value||'All',rawStart=clean($('windowStart')?.value),rawEnd=clean($('windowEnd')?.value),todayWeek=weekKey(new Date()),memoKey=`${department}|${mode}|${rawStart}|${rawEnd}|${todayWeek}`;if(scorecardWindowMemo?.key===memoKey)return scorecardWindowMemo.value;let spec;if(mode==='last'){const start=shiftDayKey(todayWeek,-7);spec={mode,start,end:shiftDayKey(start,6),weeks:1,key:`last:${start}`}}else if(mode==='custom'){const start=weekKey(rawStart),endWeek=weekKey(rawEnd);if(!start||!endWeek||start>endWeek)spec={mode,start:'',end:'',weeks:0,key:`custom:${rawStart}:${rawEnd}`};else{const weeks=Math.round((new Date(`${endWeek}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/(7*DAY))+1;spec={mode,start,end:shiftDayKey(endWeek,6),weeks,key:`custom:${start}:${endWeek}`}}}else{const weeks=Number(mode)||8,endWeek=latestBusinessWeekKey()||todayWeek,start=shiftDayKey(endWeek,-7*(weeks-1));spec={mode:'rolling',start,end:shiftDayKey(endWeek,6),weeks,key:`rolling:${weeks}:${endWeek}`}}scorecardWindowMemo={key:memoKey,value:spec};return spec}", 'selected window memoization');
}

if (!source.includes('function buildMetricPools(reps)')) {
  source = requiredReplace(source, /function teamCohortFor\(rep\)\{[^\n]*\}/, 'function teamCohortFor(){return scopedReps()}', 'scope-relative percentile cohort');
  source = requiredReplace(source, /function percentile\(value,values,higher=true\)\{[^\n]*\}/, "function percentile(value,values,higher=true,sorted=false){const v=sorted?values:(values||[]).filter(Number.isFinite).sort((a,b)=>a-b);if(!Number.isFinite(value)||!v.length)return null;if(v.length===1)return 100;let lo=0,hi=v.length;while(lo<hi){const mid=(lo+hi)>>1;if(v[mid]<value)lo=mid+1;else hi=mid}const less=lo;hi=v.length;while(lo<hi){const mid=(lo+hi)>>1;if(v[mid]<=value)lo=mid+1;else hi=mid}const equal=lo-less,position=less+Math.max(0,equal-1)/2;let p=position/(v.length-1);if(!higher)p=1-p;return Math.round(clamp(p,0,1)*100)}", 'scope percentile calculation');
  source = requiredReplace(source, /function metricPack\(person,metricId,cohort\)\{[^\n]*\}/, "function buildMetricPools(reps){const pools=new Map();for(const id of Object.keys(METRICS)){const metric=METRICS[id],values=[];for(const rep of reps){if(metric.dept==='Retail'&&personDepartment(rep)!=='Retail')continue;const cov=coverage(rep.personId,id);if(!cov.eligible)continue;const value=aggregateMetric(rep.personId,id).value;if(Number.isFinite(value))values.push(value)}values.sort((a,b)=>a-b);pools.set(id,values)}return pools}\nfunction metricPack(person,metricId,cohort,pools){const metric=METRICS[metricId],agg=aggregateMetric(person.personId,metricId),cov=coverage(person.personId,metricId),pooled=pools?.get(metricId),eligibleValues=pooled||cohort.filter(r=>coverage(r.personId,metricId).eligible).map(r=>aggregateMetric(r.personId,metricId).value),rank=cov.eligible?percentile(agg.value,eligibleValues,metric.higher,Boolean(pooled)):null,trend=trendFor(agg.points,metric.higher);return{...agg,coverage:cov,percentile:rank,trend,metric}}", 'scope metric pool calculation');
  source = requiredReplace(source, /function rowData\(rep,cohort\)\{[^\n]*\}/, "function rowData(rep,cohort,pools){const packs={},department=personDepartment(rep);for(const id of Object.keys(METRICS)){const m=METRICS[id];if(m.dept==='Retail'&&department!=='Retail')continue;packs[id]=metricPack(rep,id,cohort,pools)}const coaching=state.coachingByRep.get(rep.personId)||[],checklist=state.checklistByRep.get(rep.personId)||[],last=coaching.length?Math.max(...coaching.map(x=>x.date?.getTime()||0)):0;return{rep,packs,coaching30:activityRows(state.coachingByRep,rep.personId,30).length,checklist30:activityRows(state.checklistByRep,rep.personId,30).length,openChecklist:checklist.filter(x=>!x.served).length,daysSince:last?Math.floor((Date.now()-last)/DAY):NaN,kpiHistory:historyCoverage(rep.personId).measured,custom:Object.fromEntries(state.config.custom.map(c=>[c.id,customCount(rep.personId,c)]))}}", 'pooled scorecard row data');
  source = requiredReplace(source, /function getRows\(\)\{[^\n]*\}/, "function getRows(){const reps=scopedReps(),pools=buildMetricPools(reps),rows=reps.map(r=>rowData(r,reps,pools)),k=state.sort.key,d=state.sort.dir;if(k==='rank-overall'||k==='rank-score'||String(k).startsWith('rank:'))return rows;rows.sort((a,b)=>{let av=sortValue(a,k),bv=sortValue(b,k);if(typeof av==='string')return av.localeCompare(String(bv))*d;if(!Number.isFinite(av))av=d>0?Infinity:-Infinity;if(!Number.isFinite(bv))bv=d>0?Infinity:-Infinity;return(av-bv)*d});return rows}", 'scope-relative scorecard rows');
}
source = source
  .split('team percentiles').join('scope percentiles')
  .split('team percentile').join('scope percentile')
  .split('Insufficient team cohort').join('Insufficient scope cohort')
  .split('P${p.percentile} on team').join('P${p.percentile} in scope');

if (/<style data-scorecard-extras="true">[\s\S]*?<\/style>/.test(source)) {
  source = source.replace(/<style data-scorecard-extras="true">[\s\S]*?<\/style>/, `<style data-scorecard-extras="true">\n${extrasStyle}\n</style>`);
} else {
  source = requiredReplace(source, '</head>', `<style data-scorecard-extras="true">\n${extrasStyle}\n</style>\n</head>`, 'enhanced scorecard styles');
}

const marker = "window.addEventListener('error',e=>console.error('[Performance Scorecard]',e.error||e.message));";
if (!source.includes("const RANK_PREF_KEY='coachtools.performanceScorecard.ranking.v1'")) source = requiredReplace(source, marker, `${patch}\n${marker}`, 'ranking scorecard');

if (/\bfetch\s*\(\s*SOURCE\b|new\s+XMLHttpRequest\s*\(/.test(source)) {
  throw new Error('Generated scorecard still contains the local HTML runtime loader.');
}

fs.writeFileSync(ENHANCED_PATH, source, 'utf8');
console.log(`Generated static enhanced scorecard: ${path.relative(ROOT, ENHANCED_PATH)}`);
