'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const enhanced = fs.readFileSync(path.join(root, 'apps', 'performance-scorecard-enhanced.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps.json'), 'utf8'));
const generator = fs.readFileSync(path.join(root, 'build', 'generate-app-manifest.js'), 'utf8');

assert.match(enhanced, /coachtools-hidden[^>]+true/i, 'enhanced loader should stay hidden from app discovery');
assert.ok(enhanced.includes("function teamCohortFor(){return scopedReps()}"), 'percentiles should use the exact selected representative scope');
assert.ok(enhanced.includes('if(v.length===1)return 100'), 'single-representative scopes should report the top percentile');
assert.ok(enhanced.includes('position/(v.length-1)'), 'percentiles should span the full 0–100 range');
assert.ok(enhanced.includes("{id:'consumer-rate',higher:true}"), 'Consumer AR should be a default ranking metric');
assert.ok(enhanced.includes("{id:'wiper-rate',higher:true}"), 'Wipers should be a default ranking metric');
assert.ok(enhanced.includes("{id:'call-quality',higher:true}"), 'Call Quality should be a default ranking metric');
assert.ok(enhanced.includes('details.reduce((sum,d)=>sum+d.rank,0)'), 'rank score should sum metric rank positions');
assert.ok(enhanced.includes('Lowest is best'), 'ranking rules should support lower-is-better measures');
assert.ok(enhanced.includes('rankClearBtn'), 'ranking rules should be clearable');
assert.ok(enhanced.includes('rankAddMetric'), 'ranking rules should allow additional scorecard columns');
assert.ok(enhanced.includes('Correctives'), 'custom corrective counts should be documented as a lower-is-better ranking use case');

const scorecard = manifest.apps.find(app => app.id === 'performance-scorecard');
assert.ok(scorecard, 'Performance Scorecard must remain registered');
assert.strictEqual(scorecard.file, 'apps/performance-scorecard-enhanced.html', 'desktop should launch the enhanced scorecard');
assert.ok(generator.includes("fallbackId === 'performance-scorecard' ? 'apps/performance-scorecard-enhanced.html'"), 'manifest regeneration should preserve the enhanced route');

console.log('Performance Scorecard percentile/ranking contracts passed.');
