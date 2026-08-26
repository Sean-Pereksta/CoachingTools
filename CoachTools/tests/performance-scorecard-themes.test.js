'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'apps', 'performance-scorecard.html'), 'utf8');
const selector = html.match(/<select id="themeSel"[\s\S]*?<\/select>/)?.[0] || '';
const themeIds = Array.from(selector.matchAll(/<option value="([^"]+)"/g), match => match[1]);

assert.deepStrictEqual(themeIds, ['galactic', 'light', 'aurora', 'midnight', 'solar', 'safelite', 'ocean', 'executive', 'obsidian', 'neon', 'forest', 'rose', 'paper', 'contrast']);
assert.strictEqual(new Set(themeIds).size, themeIds.length, 'Theme IDs should be unique.');
assert(!html.includes('id="themeBtn"'), 'The old two-state theme button should be removed.');
assert(html.includes("document.body.dataset.theme=id"), 'Theme selection should apply through a stable data-theme attribute.');
assert(html.includes("localStorage.setItem(PREF_KEY,JSON.stringify(state.config))"), 'The selected theme should remain in Scorecard preferences.');
assert(html.includes("document.body.classList.toggle('theme-dark',definition.dark)"), 'Dark themes should update native form controls and color scheme.');

for (const theme of themeIds) {
  assert(html.includes(`body[data-theme="${theme}"]`), `${theme} should have a dedicated visual treatment.`);
  const treatment = html.match(new RegExp(`body\\[data-theme="${theme}"\\]\\{([^}]+)\\}`))?.[1] || '';
  assert(treatment.includes('--font-body:'), `${theme} should define its typography.`);
  assert(treatment.includes('--goal-good-bg:'), `${theme} should define stronger KPI highlight surfaces.`);
  assert(treatment.includes('--goal-bad-bg:'), `${theme} should define stronger KPI warning surfaces.`);
}

assert(html.includes('font-family:var(--font-body)'), 'The selected theme should control the page font.');
assert(html.includes('background:var(--goal-good-bg)'), 'Goal-met cells should use the theme highlight surface.');
assert(html.includes('background:var(--goal-bad-bg)'), 'Goal-miss cells should use the theme warning surface.');

const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), match => match[1]).filter(source => source.trim());
for (const source of inlineScripts) new Function(source);

console.log('Performance Scorecard theme tests passed.');
