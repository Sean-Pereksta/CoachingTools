'use strict';
const assert=require('node:assert/strict');
const Charts=require('../js/research-charts.js');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const dates=['2026-09-06','2026-09-13','2026-09-20'];
const values={Alpha:[100,100,0],Beta:[0,0,90],Gamma:[50,null,50],Missing:[null,null,null]};
const result={columns:[{label:'Value'}],hasSecondary:true,data:Object.entries(values).flatMap(([secondary,vs])=>dates.map((label,i)=>({label,secondary,values:[vs[i]]})))};
function lineMath(){
  const def=Charts.normalize({type:'line',y:[0],sort:'dateAsc',rolling:2,rollingDisplay:'only',endLabelMode:'top',endLabelCount:1}, {},result),data=Charts.buildDataset(def,result);
  assert.ok(data.series.filter(s=>!s.derived).every(s=>s.suppressed));
  assert.deepEqual(data.series.find(s=>s.parentId===data.series[2].id).points.map(p=>p.value),[50,null,50],'rolling-only never turns a missing original observation into a plotted value');
  const selected=Charts.lineLabelCandidates(def,data.series);assert.equal(selected[0].name,'Alpha · Value');assert.equal(selected[0].average,200/3,'rank by window mean, not the last point');
  assert.equal(selected[0].point.value,50,'label attaches to the rolling curve, while its text reports the original mean');
  const low=Charts.lineLabelCandidates({...def,endLabelMode:'bottom'},data.series);assert.equal(low[0].name,'Beta · Value');assert.equal(low[0].average,30);
  assert.equal(Charts.lineLabelCandidates({...def,endLabelMode:'both',endLabelCount:8},data.series).length,3,'overlapping top/bottom selections label each nonempty line once');
  const hidden=Charts.lineLabelCandidates({...def,hiddenSeries:[data.series[0].id]},data.series);assert.equal(hidden[0].name,'Gamma · Value');
  const drawing=Charts.renderSVG(def,data);assert.equal((drawing.svg.match(/data-chart-end-label=/g)||[]).length,1);assert.equal(drawing.legend.length,4);assert.ok(drawing.legend.every(s=>s.derived));assert.doesNotMatch(drawing.svg,/NaN|Infinity/);
  const raw=Charts.buildDataset({...def,rolling:0},result);assert.ok(raw.series.every(s=>!s.suppressed),'turning averaging off restores original lines');
  const many={columns:[{label:'Value'}],hasSecondary:true,data:Array.from({length:23},(_,i)=>dates.map(label=>({label,secondary:'Coach '+i,values:[i]}))).flat()},manyDef={...def,endLabelCount:3},manyData=Charts.buildDataset(manyDef,many),manyDrawing=Charts.renderSVG(manyDef,manyData);assert.equal((manyDrawing.svg.match(/data-chart-end-label=/g)||[]).length,3);assert.equal(manyDrawing.legend.length,23,'ranked labels do not hide any of the 23 visible curves');
  const legacy=Charts.normalize({endLabels:true}, {},result);assert.equal(legacy.endLabelMode,'all','old saved end-label preferences migrate');
  const narrowWindow=Charts.buildDataset({...def,start:'2026-09-20',end:'2026-09-20'},result);assert.equal(Charts.lineLabelCandidates(def,narrowWindow.series)[0].name,'Beta · Value','rank updates with the displayed date window');
  const tie={...result,data:['Zed','Able'].flatMap(secondary=>dates.map(label=>({secondary,label,values:[4]})))};
  assert.equal(Charts.lineLabelCandidates(def,Charts.buildDataset(def,tie).series)[0].name,'Able · Value','ties resolve deterministically by name');
  console.log('PASS rolling-only series, real gaps, mean-based top/bottom labels, hidden lines, ties, window changes and legacy defaults');
}
async function viewer(){
  const h=createHarness();h.context.result=result;try{
    h.run(`window.AllStarCharts=AllStarCharts;state.researchItems=[normalizeResearchItem({id:'smooth',title:'Smooth view',outputType:'line',source:'weeklyRetail',dateGrouping:'weekly'})];const item=state.researchItems[0];const original=JSON.stringify(result);AllStarCharts.register(item,result);buildQueryPlan=()=>{throw new Error('A display control reran Research');};`);
    await h.run("AllStarCharts.openViewer('smooth')");
    h.run(`const host=document.querySelector('.asc-explorer .asc-viewer'),view=host._ascViewer;const set=(key,value)=>{const n=host.querySelector('[data-v-setting='+key+']');n.value=value;n.onchange();};set('rolling',2);host.querySelector('[data-v-focus]').click();set('rollingDisplay','only');set('endLabelMode','top');set('endLabelCount',1);`);
    assert.equal(h.run('view.current.data.series.filter(s=>s.layerKind==="rolling").length'),4,'focusing one series does not remove other rolling-only series');
    assert.equal(h.run('host.querySelectorAll("[data-chart-end-label]").length'),1);
    const plot=h.run('host.querySelector("[data-v-svg]").innerHTML');assert.doesNotMatch(plot,/data-chart-path="\[.*?\]"/,'original paths are absent');
    h.run("host.querySelector('[data-v-defaults]').click();");
    const preferences=JSON.parse(h.storage.get('allstar.researchChartViews.v1')).views[0].preferences;assert.equal(preferences.rollingDisplay,'only');assert.equal(preferences.endLabelMode,'top');
    const capture=plain(h.run('AllStarCharts.captureSurface(view.current.def,view.current.data,view.current)'));assert.ok(capture.legend.every(s=>s.derived));assert.match(capture.svg,/Rolling average only/);
    assert.equal(h.run('JSON.stringify(result)'),h.run('original'));
    h.run("document.querySelector('.asc-explorer [data-asc-close]').click();");
    const next=createHarness(h.storage);next.context.result=result;try{assert.equal(next.run("AllStarCharts.viewerSession({id:'smooth',outputType:'line'},result).preferences.rollingDisplay"),'only');}finally{next.close();}
    assert.deepEqual(h.errors,[]);
    console.log('PASS actual viewer controls, selected-line independence, saved defaults, matching captures and no recalculation');
  }finally{h.close();}
}
function datedGraphs(){
  const h=createHarness();h.context.result={data:result.data.map(r=>({line:r.secondary,label:r.label,value:r.values[0],unit:'sessions',eligibleRepresentatives:2,missingRepresentatives:0,numerator:r.values[0],denominator:2,contributions:[],exclusions:[]})),axisLabels:dates,measureLabel:'Coaching count',description:'Coaching count',warnings:[]};
  try{
    h.run(`const item={id:'dated-smooth',title:'Weekly coachings',datedStats:{},outputType:'line'};const host=document.createElement('div');document.body.appendChild(host);host.innerHTML=renderDatedStatsResult(item,result);bindDatedStatsCharts(host);const original=JSON.stringify(result);const set=(key,value)=>{const n=host.querySelector('[data-ds='+key+']');n.value=value;n.onchange();};set('rolling',2);set('rollingDisplay','only');set('endLabelMode','bottom');`);
    assert.equal(h.run("host.querySelectorAll('[data-chart-end-label]').length"),1);assert.match(h.run("host.querySelector('[data-chart-end-label]').textContent"),/Beta/);
    assert.equal(h.run("host.querySelectorAll('[data-ds-line]').length"),4);
    h.run("host.querySelector('[data-ds-smoothed]').onclick();");assert.match(h.run("document.querySelector('.ds-dialog').textContent"),/Evidence below is the original value/);
    h.run("host.querySelector('[data-ds-save-view]').click();host.innerHTML=renderDatedStatsResult(item,result);bindDatedStatsCharts(host);");assert.equal(h.run("host.querySelector('[data-ds=rollingDisplay]').value"),'only');assert.equal(h.run("host.querySelector('[data-ds=endLabelMode]').value"),'bottom');
    assert.equal(h.run('JSON.stringify(result)'),h.run('original'));assert.deepEqual(h.errors,[]);
    console.log('PASS dated coaching/calculated graphs share smoothing and labels, retain raw evidence, and reopen saved settings');
  }finally{h.close();}
}
function workspace(){
  const h=createHarness();try{
    h.run(`window.AllStarResearchWorkspace.init();state.data.retail.sv2=[{Name:'Rep'}];state.researchItems=['a','b','c'].map(id=>normalizeResearchItem({id,title:'Item '+id,source:'retail_sv2',outputType:'table'}));openModal('researchModal');renderResearchCanvasShell('Ready');const canvas=els.researchCanvas;const ids=()=>[...canvas.querySelectorAll('[data-research-card]')].map(c=>c.dataset.researchCard);const key=(id,key)=>{const e=new Event('keydown',{bubbles:true,cancelable:true});e.key=key;canvas.querySelector('[data-rw-drag='+id+']').dispatchEvent(e);};let queries=0;evaluateResearchItemAsync=()=>{queries++;throw new Error('Layout recalculated data');};`);
    assert.equal(h.run('canvas.querySelectorAll("[data-research-move]").length'),0);
    h.run("setResearchCanvasStatus('Updated · Correctives');");assert.equal(h.run("el('researchCanvasStatus').textContent"),'Updated · Correctives');assert.equal(h.run("canvas.querySelector('[data-research-status]')"),null);
    h.run("el('researchDiagnosticsBtn').click();");assert.equal(h.run("el('researchDiagnosticsDrawer').hasAttribute('open')"),true);h.run("el('researchDiagnosticsDrawer').querySelector('button').click();");assert.equal(h.run("el('researchDiagnosticsDrawer').hasAttribute('open')"),false);
    h.run(`const body=canvas.querySelector('[data-research-card=a] .researchCardBody');body.innerHTML=researchJoinSummaryHtml({calls:1,ambiguousIdentities:1,ambiguityDetails:[{identity:'Duplicate Rep',ids:['1','2']}]});bindResearchCanvasActions();`);
    assert.equal(h.run("body.querySelector('[data-research-ambiguous-joins]')"),null);assert.match(h.run("canvas.querySelector('[data-research-card=a] .rwCardMoreMenu [data-research-ambiguous-joins]').textContent"),/Duplicate Rep/);
    h.run("body.innerHTML=researchJoinSummaryHtml({calls:1,ambiguousIdentities:0});bindResearchCanvasActions();");assert.equal(h.run("canvas.querySelector('[data-research-ambiguous-joins]')"),null);
    h.run("key('a',' ');key('a','ArrowDown');");assert.deepEqual(plain(h.run('ids()')),['b','a','c']);assert.deepEqual(plain(h.run('state.researchItems.map(i=>i.id)')),['a','b','c'],'keyboard placement is a preview until confirmed');
    h.run("key('a','Escape');");assert.deepEqual(plain(h.run('ids()')),['a','b','c']);
    h.run("key('a',' ');key('a','ArrowDown');key('a','Enter');");assert.deepEqual(plain(h.run('ids()')),['b','a','c']);assert.deepEqual(JSON.parse(h.storage.get('allStarResearchItems.v1')).map(i=>i.id),['b','a','c']);
    h.run(`const c=canvas.querySelector('[data-research-card=c]');canvas.getBoundingClientRect=()=>({left:0,right:1000,top:0,bottom:800,width:1000});c.getBoundingClientRect=()=>({left:0,top:400,width:1000,height:200});document.elementFromPoint=()=>c;const pointer=(type,x,y)=>{const e=new Event(type,{bubbles:true,cancelable:true});e.button=0;e.clientX=x;e.clientY=y;return e;};canvas.querySelector('[data-rw-drag=b]').dispatchEvent(pointer('pointerdown',10,10));document.dispatchEvent(pointer('pointermove',400,580));document.dispatchEvent(pointer('pointerup',400,580));`);
    assert.deepEqual(plain(h.run('ids()')),['a','c','b'],'pointer drop moves the actual card nodes');assert.deepEqual(plain(h.run('state.researchItems.map(i=>i.id)')),['a','c','b']);
    h.run(`const setItem=localStorage.setItem;localStorage.setItem=()=>{throw new Error('storage full');};key('a',' ');key('a','ArrowDown');key('a','Enter');localStorage.setItem=setItem;`);assert.deepEqual(plain(h.run('ids()')),['a','c','b'],'failed persistence rolls back the DOM and definitions');assert.match(h.run("el('researchCanvasStatus').textContent"),/restored/);
    assert.equal(h.run('queries'),0);assert.deepEqual(h.errors,[]);
    console.log('PASS compact status, diagnostics popup, conditional ambiguity menu, pointer/keyboard ordering, cancellation and save-failure rollback without recalculation');
  }finally{h.close();}
}
(async()=>{lineMath();await viewer();datedGraphs();workspace();})().catch(error=>{console.error(error);process.exitCode=1;});
