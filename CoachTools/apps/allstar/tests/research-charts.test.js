'use strict';
const assert=require('node:assert/strict');
const charts=require('../js/research-charts.js');
const {parseHTML}=require('linkedom');

const records=new Map([['existing.research','must remain intact']]);
const storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)};
charts.configure({storage});
const result={columns:[{field:'Rate',label:'Rate',mode:'avg'},{field:'Count',label:'Count',mode:'sum'}],data:[
  {label:'2026-09-01',dateValue:Date.UTC(2026,8,1),secondary:'Team A',values:[0,10],rows:20},
  {label:'2026-09-02',dateValue:Date.UTC(2026,8,2),secondary:'Team A',values:[10,20],rows:40},
  {label:'2026-09-03',dateValue:Date.UTC(2026,8,3),secondary:'Team A',values:[null,30],rows:60},
  {label:'2026-09-01',dateValue:Date.UTC(2026,8,1),secondary:'Team B',values:[20,4],rows:8},
  {label:'2026-09-03',dateValue:Date.UTC(2026,8,3),secondary:'Team B',values:[-10,2],rows:4}
]};
const original=JSON.stringify(result);
const def=charts.normalize({type:'line',y:[0],sort:'dateAsc'},{id:'rates',title:'Rates'},result);
const built=charts.buildDataset(def,result);
assert.equal(built.series.length,2);
assert.deepEqual(built.series[0].points.map(p=>p.value),[0,10,null],'Missing values remain gaps, not zero');
assert.deepEqual(built.series[1].points.map(p=>p.value),[20,null,-10],'Missing series periods align without zero invention');
const count=charts.stats.datasetBuilds;
assert.equal(charts.buildDataset({...def,title:'New title',lineWidth:7,legend:false,format:'decimal_percent',hiddenSeries:['hidden']},result),built,'Appearance edits reuse the exact projected dataset');
assert.equal(charts.stats.datasetBuilds,count);
assert.equal(JSON.stringify(result),original,'Chart datasets never modify business results');

const roll=charts.buildDataset({...def,rolling:2,cumulative:true,previous:true},result);
assert.deepEqual(roll.series[0].points.map(p=>p.value),[0,10,null]);
assert.deepEqual(roll.series.find(s=>s.name==='Team A · Rate · 2-point average').points.map(p=>p.value),[0,5,10]);
assert.deepEqual(roll.series.find(s=>s.name==='Team A · Rate · previous 1 point').points.map(p=>p.value),[null,0,10]);
const percentChange=charts.buildDataset({...def,change:'percent'},result);
assert.deepEqual(percentChange.series[0].points.map(p=>p.value),[null,null,null],'Zero baseline produces undefined percent change');
const filtered=charts.buildDataset({...def,start:'2026-09-02',end:'2026-09-02'},result);
assert.equal(filtered.labels.length,1);
assert.equal(filtered.series[0].points[0].value,10);
assert.equal(filtered.filtered,4);

const duplicates={columns:[{label:'Value'}],data:[{label:'Same',values:[2]},{label:'Same',values:[5]}]};
const kept=charts.buildDataset({type:'bar',y:[0]},duplicates);
assert.equal(kept.labels.length,2,'Repeated categories are preserved by default');
assert.deepEqual(kept.series[0].points.map(p=>p.value),[2,5]);
const summed=charts.buildDataset({type:'bar',y:[0],aggregation:'sum'},duplicates);
assert.equal(summed.series[0].points[0].value,7);
assert.equal(summed.series[0].points[0].refs.length,2);

const histogram=charts.buildDataset({...def,type:'histogram',bins:3},result);
assert.equal(histogram.series.reduce((sum,s)=>sum+s.points.reduce((n,p)=>n+p.value,0),0),4,'Histogram excludes missing values and counts calculated groups');
assert.ok(histogram.warnings.some(w=>w.includes('not individual source rows')));
const scatter=charts.buildDataset({...def,type:'scatter',x:'value:1'},result);
assert.equal(scatter.series[0].points[1].x,20);
assert.equal(scatter.statistics[0].n,2);
assert.equal(scatter.statistics[0].r,1,'Pearson correlation uses finite pairs only');
assert.equal(charts.buildDataset({type:'scatter',x:'value:0',y:[0]},{columns:[{label:'Constant'}],data:[{label:'A',values:[3]},{label:'B',values:[3]}]}).statistics[0].r,null,'Constant axes have undefined correlation');
for(const type of ['line','multi-line','bar','grouped-bar','stacked-bar','area','scatter','bubble','histogram','combo']){
  const cfg=charts.normalize({...def,type,x:type==='scatter'||type==='bubble'?'value:1':'label'}, {},result);
  const drawing=charts.renderSVG(cfg,charts.buildDataset(cfg,result));
  assert.match(drawing.svg,/<svg/);
  assert.doesNotMatch(drawing.svg,/(?:NaN|Infinity)/,'SVG values must stay finite for '+type);
}
assert.equal(charts.recommend({groupField:'Team',dateGrouping:'daily',dateColumn:'Date'},{columns:[{label:'Value'}],data:[{label:'Team A',dateValue:123,values:[3]}]}),'bar','Default daily setting must not classify team groups as time series');
assert.equal(charts.recommend({},result),'multi-line');
assert.equal(charts.format(.524,{format:'decimal_percent',decimals:1}),'52.4%');
assert.equal(charts.format(52.4,{format:'percent',decimals:1}),'52.4%');
assert.equal(charts.format(null,{format:'number'}),'—');
const injected=charts.renderSVG(charts.normalize({title:'<script>bad()</script>'},{},duplicates),kept).svg;
assert.doesNotMatch(injected,/<script>/);
assert.match(injected,/&lt;script&gt;/);
assert.match(charts.toCSV({series:[{name:'=HYPERLINK("bad")',points:[{label:'@cmd',value:-3,refs:[]}]}]}),/"'=HYPERLINK/,'CSV labels cannot become spreadsheet formulas');

const saved=charts.saveDefinition({...def,title:'Independent chart'});
assert.ok(saved.id);
assert.equal(charts.savedCharts().length,1);
assert.equal(charts.savedCharts()[0].researchId,'rates');
assert.equal('data' in charts.savedCharts()[0],false,'Chart storage contains definitions, not duplicate datasets');
charts.saveDefinition({...saved,title:'Updated title'});
assert.equal(charts.savedCharts().length,1);
const one=charts.pinCard({type:'chart',chartId:saved.id,title:'Chart'});
const two=charts.pinCard({type:'table',researchId:'rates',title:'Table'});
charts.moveCard(two.id,-1);
assert.deepEqual(charts.boardCards().map(c=>c.id),[two.id,one.id]);
charts.removeCard(one.id);
assert.deepEqual(charts.boardCards().map(c=>c.id),[two.id]);
assert.equal(records.get('existing.research'),'must remain intact','Existing storage is untouched');
const beforeQuota=records.get(charts.keys.charts);
charts.configure({storage:{getItem:storage.getItem,setItem(){throw new Error('Quota');}}});
assert.throws(()=>charts.saveDefinition({...saved,title:'Should fail'}),/could not be saved/);
assert.equal(records.get(charts.keys.charts),beforeQuota);
charts.configure({storage});
records.set(charts.keys.charts,'{"schemaVersion":99,"charts":[]}');
assert.throws(()=>charts.saveDefinition(def),/version is not supported/);
assert.equal(records.get(charts.keys.charts),'{"schemaVersion":99,"charts":[]}');
records.set(charts.keys.charts,beforeQuota);

const kpi={rowKey:charts.resultRowKey(result.data[1]),columnKey:charts.resultColumnKey(result,0)};
const reordered={columns:[result.columns[1],result.columns[0]],data:result.data.slice().reverse().map(row=>({...row,values:[row.values[1],row.values[0]]}))};
const boundChart=charts.normalize({...def,type:'scatter',x:'value:1',bubble:1,hiddenSeries:['["Team A","",0]']},{},result);
const rebound=charts.normalize(boundChart,{},reordered);
assert.deepEqual(rebound.y,[1],'Saved chart Y follows measure identity after column reorder');
assert.equal(rebound.x,'value:0');
assert.equal(rebound.bubble,0);
assert.deepEqual(rebound.hiddenSeries,['["Team A","",1]']);
assert.throws(()=>charts.normalize(boundChart,{}, {columns:[{field:'Different',label:'Different'}],data:[{label:'A',values:[55]}]}),/measure is missing or ambiguous/,'Missing chart measure cannot silently bind to a different column');
assert.equal(charts.resolveKPI(kpi,reordered).value,10,'Pinned KPI follows row and column identities through sorting and column reorder');
assert.equal(charts.resolveKPI(kpi,{...result,data:[result.data[1],result.data[1]]}),null,'Ambiguous KPI group does not silently show a different value');
assert.equal(charts.resolveKPI(kpi,{...result,data:[]}),null);
const comparison=charts.compareGroups(result,[0,1,2],[3,4],0);
assert.equal(comparison.a.n,2);
assert.equal(comparison.a.missing,1);
assert.equal(comparison.a.mean,5);
assert.equal(comparison.a.median,5);
assert.equal(comparison.b.mean,5);
assert.equal(comparison.difference,0);
assert.equal(charts.compareGroups(result,[0],[1],0).percentDifference,null);
assert.equal(charts.compareGroups(result,[0,1],[1,4],0).overlap,1);

const {document}=parseHTML('<!doctype html><html><body></body></html>');
global.document=document;
const view=charts.open({id:'rates',title:'Rates'},result,{...def,id:'saved-chart'});
const beforeTitleEdit=charts.stats.datasetBuilds;
const title=view.body.querySelector('[data-setting="title"]');title.value='Edited in UI';title.onchange();
assert.equal(view.body.querySelector('[data-title]').textContent,'Edited in UI');
assert.equal(charts.stats.datasetBuilds,beforeTitleEdit,'Title input does not rebuild data or run Research');
view.body.querySelector('[data-undo]').onclick();
assert.equal(view.body.querySelector('[data-title]').textContent,'Rates');
view.body.querySelector('[data-redo]').onclick();
assert.equal(view.body.querySelector('[data-title]').textContent,'Edited in UI');
view.body.querySelector('[data-save]').onclick();
assert.equal(view.body.querySelector('[data-save-state]').textContent,'Saved');
view.close();
delete global.document;
console.log('PASS All-Star charts: ten offline chart types, missing values, cache-only appearance, stable KPI identities, cohorts, storage safety, designer undo/save');
