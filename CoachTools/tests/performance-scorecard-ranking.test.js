'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const enhanced = fs.readFileSync(path.join(root, 'apps', 'performance-scorecard-enhanced.html'), 'utf8');
const extraCss = fs.readFileSync(path.join(root, 'shared', 'performance-scorecard-extras.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const generator = fs.readFileSync(path.join(root, 'build', 'generate-app-manifest.js'), 'utf8');

assert.match(enhanced, /coachtools-hidden[^>]+true/i, 'enhanced scorecard should stay hidden from app discovery');
assert.ok(enhanced.includes("function teamCohortFor(){return scopedReps()}"), 'percentiles should use the exact selected representative scope');
assert.ok(enhanced.includes('if(v.length===1)return 100'), 'single-representative scopes should report the top percentile');
assert.ok(enhanced.includes('position/(v.length-1)'), 'percentiles should span the full 0–100 range');
assert.ok(enhanced.includes('scorecardWindowMemo'), 'selected scorecard windows should be memoized during row construction');
assert.ok(enhanced.includes('latestBusinessWeekMemo'), 'latest business week scans should be memoized per department');
assert.ok(enhanced.includes('function buildMetricPools(reps)'), 'scope percentile metric pools should be built once per render');
assert.ok(enhanced.includes('Boolean(pooled)'), 'row percentiles should reuse sorted scope metric pools');
assert.ok(enhanced.includes("{id:'consumer-rate',higher:true}"), 'Consumer AR should be a default ranking metric');
assert.ok(enhanced.includes("{id:'wiper-rate',higher:true}"), 'Wipers should be a default ranking metric');
assert.ok(enhanced.includes("{id:'call-quality',higher:true}"), 'Call Quality should be a default ranking metric');
assert.ok(enhanced.includes('function buildRankMap(values,higher)'), 'ranking should precompute rank maps instead of rescanning every row');
assert.ok(!enhanced.includes('values.filter(v=>higher?v>value:v<value).length'), 'ranking should not use quadratic rank-position scans');
assert.ok(enhanced.includes('details.reduce((sum,d)=>sum+d.rank,0)'), 'rank score should sum metric rank positions');
assert.ok(enhanced.includes('Lowest is best'), 'ranking rules should support lower-is-better measures');
assert.ok(enhanced.includes('rankClearBtn'), 'ranking rules should be clearable');
assert.ok(enhanced.includes('rankAddMetric'), 'ranking rules should allow additional scorecard columns');
assert.ok(enhanced.includes('Correctives'), 'custom corrective counts should be documented as a lower-is-better ranking use case');

assert.ok(enhanced.includes('data-normal-rank-sort'), 'normal scorecard should expose the Overall Rank column');
assert.ok(enhanced.includes('function normalOverallRankCell(row)'), 'normal scorecard should reuse the ranking score for its Overall Rank cell');
assert.ok(enhanced.includes("options.push(['rank-overall','Overall Rank'])"), 'Overall Rank should be available in the normal sort dropdown');
assert.ok(enhanced.includes('displayModeSel'), 'scorecard should expose the display mode selector next to sorting');
assert.ok(enhanced.includes('<option value="normal">Normal</option>'), 'display selector should include Normal');
assert.ok(enhanced.includes('<option value="basic">Basic</option>'), 'display selector should include Basic');
assert.ok(enhanced.includes('<option value="advanced">Advanced</option>'), 'display selector should include Advanced');
assert.ok(enhanced.includes('metricMainBasic'), 'Basic mode should use the large-number KPI presentation');
assert.ok(enhanced.includes('metricRankInfo(p)'), 'Advanced mode should include ordinal KPI rank information');
assert.ok(enhanced.includes('metricOrdinal'), 'Advanced mode should render KPI rank in the metric box');

for (const theme of ['Nova Violet','Emerald Circuit','Copper Forge','Ice Prism','Monochrome Luxe']) {
  assert.ok(enhanced.includes(theme), `${theme} should be registered in the scorecard theme selector`);
}
for (const id of ['nova','circuit','copper','prism','mono']) {
  assert.ok(extraCss.includes(`body[data-theme="${id}"]`), `${id} should have a complete theme definition`);
}

assert.ok(enhanced.includes('../vendor/html2canvas.min.js'), 'PNG/PDF scorecard snips should use the vendored html2canvas dependency');
assert.ok(enhanced.includes('../vendor/jspdf.umd.min.js'), 'PDF scorecard snips should use the vendored jsPDF dependency');
assert.ok(enhanced.includes('data-scorecard-export="png"'), 'scorecard should provide PNG snipping');
assert.ok(enhanced.includes('data-scorecard-export="pdf"'), 'scorecard should provide PDF snipping');
assert.ok(enhanced.includes("cloneWrap.style.maxHeight='none'"), 'full-scorecard export should remove the viewport height clip');
assert.ok(enhanced.includes('pixelBudget=28000000'), 'scorecard export should cap raster work to avoid large-capture freezes');
assert.ok(enhanced.includes('for(let y=0;y<canvas.height;y+=slicePx)'), 'PDF export should paginate long scorecards instead of shrinking everything to one page');
assert.ok(enhanced.includes('data-scorecard-extras="true"'), 'enhanced scorecard should inline the theme/control stylesheet for file:// safety');

assert.ok(!enhanced.includes("fetch(SOURCE"), 'enhanced scorecard must not fetch the base HTML at runtime');
assert.ok(!enhanced.includes('new XMLHttpRequest'), 'enhanced scorecard must not use XHR to load local HTML');
assert.ok(enhanced.includes('function installExportSafeCloneStyles(doc)'), 'scorecard export should sanitize unsupported CSS color functions in the clone');
assert.ok(enhanced.includes('scorecardExportSafe .main .summary.metric:after'), 'export clone should disable unsupported color-mix radial pseudo gradients');
assert.ok(!enhanced.includes("link.href='../shared/performance-scorecard-extras.css'"), 'enhanced scorecard should not reload local enhanced CSS inside html2canvas clones');

const scorecard = manifest.apps.find(app => app.id === 'performance-scorecard');
assert.ok(scorecard, 'Performance Scorecard must remain registered');
assert.strictEqual(scorecard.file, 'apps/performance-scorecard-enhanced.html', 'desktop should launch the enhanced scorecard');
assert.ok(generator.includes("fallbackId === 'performance-scorecard' ? 'apps/performance-scorecard-enhanced.html'"), 'manifest regeneration should preserve the enhanced route');

console.log('Performance Scorecard percentile/ranking/display/export contracts passed.');
