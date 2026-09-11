'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../apps/performance-scorecard.html'),'utf8');
const ctx=vm.createContext({window:{}});
vm.runInContext(html.slice(html.indexOf('function hasCompletenessValue'),html.indexOf('function completenessValue')),ctx);
const {filter,hasValue}=ctx.window.CoachToolsCompleteness;
for(const v of [0,'0','0%',12])assert(hasValue(v));
for(const v of [null,undefined,'',' ','N/A','unavailable',NaN])assert(!hasValue(v));
const rows=[{rep:{personId:'none'},a:null,b:''},{rep:{personId:'zero'},a:0,b:undefined},{rep:{personId:'full'},a:0,b:1}],original=JSON.stringify(rows);
assert.equal(filter(rows,['a','b'],(r,id)=>r[id],'populated',1).length,1);
assert.equal(filter(rows,['a','b'],(r,id)=>r[id],'missing',2).length,2);
assert.equal(filter(rows,['a'],(r,id)=>r[id],'missing',1).length,2);
assert.equal(filter(rows,['a','b'],(r,id)=>r[id],'none',999).length,3);
assert.equal(filter(rows,[],(r,id)=>r[id],'populated',0).length,3);
assert.equal(JSON.stringify(rows),original);
for(const name of ['performance-scorecard.html','performance-scorecard-enhanced.html']){
 const page=fs.readFileSync(path.join(__dirname,'../apps',name),'utf8');
 const controls={departmentSel:{value:'Retail'},completenessMode:{value:'populated',addEventListener(){}},completenessThreshold:{value:'0',addEventListener(){}},completenessSummary:{}};
 let rendered=[];
 const context=vm.createContext({window:{},state:{config:{columns:['representative','a','b'],custom:[]},sort:{}},$:id=>controls[id],personDepartment:()=> 'Retail',visibleColumn:()=>true,sortValue:(row,id)=>row[id],getRows:()=>rows,matchesQuickFilter:()=>true,renderSummary(){},renderQuickFilters(){},renderTable:r=>rendered=r,rankingState:{active:false,rules:[{id:'b'}]},rankingRuleApplies:()=>true,renderRankingTable:r=>rendered=r,prepareNormalRankContext(){},syncRankingViewButton(){},syncDisplayModeControl(){},renderRankingConfig(){}});
 vm.runInContext(page.slice(page.indexOf('function hasCompletenessValue'),page.indexOf('function getRows')),context);
 const finalRender=page.split('\n').filter(line=>line.startsWith('function render(){')).at(-1);
 vm.runInContext(finalRender+'\nrender();',context);assert.equal(rendered.length,2,name+' normal mode');
 context.rankingState.active=true;vm.runInContext('render()',context);assert.equal(rendered.length,1,name+' ranking columns');
 controls.completenessMode.value='none';vm.runInContext('render()',context);assert.equal(rendered.length,3);
 assert.match(controls.completenessSummary.textContent,/Showing 3 of 3/);
}
console.log('PASS completeness: zeros, thresholds, active columns, normal/ranking rendering, restore, immutability');
