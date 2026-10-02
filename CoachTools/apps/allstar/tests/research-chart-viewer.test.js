'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./research-weekly-rates.test.js');
const {plain}=require('./modernization-compatibility.test.js');

async function interactiveWorkflow(){
  const h=fixture(23);try{
    h.run('window.AllStarCharts=AllStarCharts;const item=setupRate();');
    const result=await h.run('evaluateResearchItemAsync(item)');h.context.chartResult=result;
    const detail=plain(result.data[0].pointDetails[0]);
    assert.equal(detail.representatives,2);assert.equal(detail.sum,90);assert.equal(detail.numerator,17);assert.equal(detail.denominator,100);
    assert.equal(detail.method,'representative_average');
    const compact=await h.run('researchCompactRenderedResult(item,chartResult)');h.context.compactResult=compact;
    assert.deepEqual(plain(compact.data[0].pointDetails),plain(result.data[0].pointDetails),'point context survives saved results');
    h.run(`
      state.researchItems=[item];openModal('researchModal');
      els.researchCanvas.innerHTML=researchCardShell(item,renderResearchResultByDisplay(item,compactResult));bindResearchCanvasActions();
      let sourceReads=0,queries=0;const originalQuery=buildQueryPlan;
      state.data.weeklyRetail.rows=new Proxy(rows,{get(target,key,receiver){if(/^\\d+$/.test(String(key))){sourceReads++;throw new Error('Viewer accessed source rows');}return Reflect.get(target,key,receiver);}});
      buildQueryPlan=(...args)=>{queries++;throw new Error('Viewer reran Research');};
      const definitionBefore=JSON.stringify(state.researchItems),resultBefore=JSON.stringify(compactResult);
      const card=document.querySelector('[data-research-card]'),host=card.querySelector('[data-asc-viewer]');
      const session=AllStarCharts.viewerSession(item,compactResult),baseIds=host._ascViewer.current.allSeries.map(s=>s.id);
      const clickSeries=id=>[...host.querySelectorAll('[data-v-toggle]')].find(b=>b.dataset.vToggle===id).click();
    `);
    assert.equal(h.run('host._ascViewer.current.visible.length'),23);
    assert.equal(h.run("card.querySelector('.researchActions').children.length"),2,'Only fullscreen and More are permanent header actions');
    assert.ok(h.run("!!card.querySelector('[data-research-edit]').closest('.rwCardMoreMenu')"));
    assert.ok(h.run("!!card.querySelector('[data-asc-open]').closest('.rwCardMoreMenu')"));
    const pointsBefore=plain(h.run('host._ascViewer.current.allSeries[1].points.map(p=>p.value)'));
    h.run('clickSeries(baseIds[1]);');assert.equal(h.run('host._ascViewer.current.visible.length'),22);
    assert.equal(h.run("[...host.querySelectorAll('[data-v-toggle]')].find(b=>b.dataset.vToggle===baseIds[1]).getAttribute('aria-pressed')"),'false');
    h.run('clickSeries(baseIds[1]);');assert.equal(h.run('host._ascViewer.current.visible.length'),23);
    assert.deepEqual(plain(h.run('host._ascViewer.current.allSeries[1].points.map(p=>p.value)')),pointsBefore);
    h.run("host.querySelector('[data-v-hide]').click();clickSeries(baseIds[0]);clickSeries(baseIds[2]);clickSeries(baseIds[4]);");
    assert.equal(h.run('host._ascViewer.current.visible.length'),3);
    h.run("host.querySelector('[data-v-show]').click();els.researchCanvas.scrollTop=183;card.querySelector('[data-rw-fullscreen-item]').click();");
    await new Promise(resolve=>setTimeout(resolve,0));
    h.run("const full=document.querySelector('.asc-explorer'),explorer=full.querySelector('.asc-viewer'),viewer=explorer._ascViewer;const setLayer=(key,value)=>{const control=explorer.querySelector('[data-v-setting='+key+']');if(control.type==='checkbox')control.checked=value;else control.value=value;control.onchange();};");
    assert.equal(h.run('viewer.session.result===compactResult'),true,'Fullscreen reuses exact saved result');
    assert.equal(h.run("full.querySelector('[data-asc-close]').textContent"),'×');
    assert.ok(h.run("!!explorer.querySelector('[data-v-setting=trendMode]')"));
    h.run("explorer.querySelector('[data-v-search]').value='Coach 12';explorer.querySelector('[data-v-search]').oninput({target:explorer.querySelector('[data-v-search]')});");
    assert.equal(h.run("[...explorer.querySelectorAll('[data-v-row]')].filter(n=>!n.hidden).length"),1);
    h.run("explorer.querySelector('[data-v-search]').value='';explorer.querySelector('[data-v-search]').oninput({target:explorer.querySelector('[data-v-search]')});explorer.querySelector('[data-v-isolate]').click();");
    assert.equal(h.run('viewer.current.visible.length'),1);
    h.run("explorer.querySelector('[data-v-show]').click();");assert.equal(h.run('viewer.current.visible.length'),23);
    h.run("explorer.querySelector('[data-v-isolate]').click();setLayer('trendMode','all');setLayer('rolling',4);setLayer('previous',true);setLayer('benchmark','organization');setLayer('target',50);setLayer('targetEnabled',true);");
    assert.equal(h.run('viewer.current.data.series.filter(s=>s.derived).length'),5);
    assert.ok(h.run('viewer.current.data.series.find(s=>s.id.endsWith("linear trend")).points.every(p=>p.value===45)'));
    assert.ok(h.run('viewer.current.data.series.find(s=>s.id.includes("4-week")).points.every(p=>p.value===45)'));
    assert.equal(h.run('viewer.current.data.series.find(s=>s.id.endsWith("previous week")).points[0].value'),null);
    assert.equal(h.run('viewer.current.data.series.find(s=>s.id==="benchmark").points[0].value'),45);
    h.run("setLayer('window','4');");assert.equal(h.run('viewer.current.data.labels.length'),4);
    h.run("explorer.querySelector('[data-v-reset]').click();explorer.querySelector('[data-v-show]').click();setLayer('trendMode','off');setLayer('rolling',0);setLayer('previous',false);setLayer('benchmark','off');setLayer('targetEnabled',false);");
    assert.equal(h.run('viewer.current.data.labels.length'),12);assert.equal(h.run('viewer.current.visible.length'),23);
    h.run("const point=explorer.querySelector('[data-chart-point]');point.onmouseenter();");
    assert.match(h.run("explorer.querySelector('[data-v-tooltip]').textContent"),/Representatives included: 2/);
    assert.match(h.run("explorer.querySelector('[data-v-tooltip]').textContent"),/Average of representative rates/);
    h.run('point.onclick();');
    assert.match(h.run("explorer.querySelector('[data-v-detail]').textContent"),/Consumer Appointments: 17/);
    h.run("const line=explorer.querySelector('[data-chart-hit]');line.onclick();");
    assert.equal(h.run("explorer.querySelectorAll('.asc-series-focused').length"),1);
    const selected=plain(h.run('viewer.session.preferences.selectedPoint'));
    h.run("setLayer('endLabelMode','all');explorer.querySelector('[data-v-defaults]').click();");
    assert.equal(JSON.parse(h.storage.get('allstar.researchChartViews.v1')).views[0].preferences.endLabels,true);
    h.run("explorer.querySelector('[data-v-panel-toggle]').click();");assert.equal(h.run("explorer.classList.contains('asc-panel-collapsed')"),true);
    assert.equal(h.run("explorer.querySelector('.asc-view-panel').hidden"),true,'collapsed controls are excluded from the focus trap');
    h.run("full.querySelector('[data-asc-close]').click();");
    assert.equal(h.run("document.querySelector('.asc-explorer')"),null);assert.equal(h.run('els.researchCanvas.scrollTop'),183);
    assert.equal(h.run('card.isConnected'),true);assert.equal(h.run('host.isConnected'),true,'original card survives fullscreen');
    await h.run('AllStarCharts.openViewer(item.id)');
    assert.deepEqual(plain(h.run('session.preferences.selectedPoint')),selected);
    assert.match(h.run("document.querySelector('.asc-explorer [data-v-detail]').textContent"),/Selected point/);
    h.run("const reopened=document.querySelector('.asc-explorer');const escEvent=new Event('keydown',{bubbles:true,cancelable:true});escEvent.key='Escape';reopened.dispatchEvent(escEvent);");
    assert.equal(h.run("document.querySelector('.asc-explorer')"),null);
    h.run("const fEvent=new Event('keydown',{bubbles:true,cancelable:true});fEvent.key='f';card.dispatchEvent(fEvent);");await new Promise(resolve=>setTimeout(resolve,0));
    assert.ok(h.run("!!document.querySelector('.asc-explorer')"));
    h.run("document.querySelector('.asc-explorer [data-asc-close]').click();");
    assert.equal(h.run('sourceReads'),0);assert.equal(h.run('queries'),0);
    assert.equal(h.run('JSON.stringify(state.researchItems)'),h.run('definitionBefore'));
    assert.equal(h.run('JSON.stringify(compactResult)'),h.run('resultBefore'));
    assert.deepEqual(h.errors,[]);
    console.log('PASS actual card/fullscreen legend, isolate, restore, search, layers, dates, point context, X/Escape/F, scroll and session preservation with zero query/source reads');
  }finally{h.close();}
}

async function benchmarkAndCapture(){
  const h=fixture();try{
    h.run(`
      const benchmarkItem={id:'benchmark',title:'Consumer Appointment Rate by Coach',outputType:'line',source:'weeklyRetail',dateGrouping:'weekly',baseGrain:'representative',measureId:'cash_appointment_rate',showPercent:true,populationScope:{includeOrgs:['Retail Coaches']}};
      const benchmarkResult={columns:[{label:'Consumer Appointment Rate'}],hasSecondary:true,data:[
        {label:'2026-09-20',dateValue:Date.UTC(2026,8,20),secondary:'Coach A',values:[45],pointDetails:[{method:'representative_average',valueType:'percentage',count:2,sum:90,representatives:2,numerator:17,denominator:100}]},
        {label:'2026-09-20',dateValue:Date.UTC(2026,8,20),secondary:'Coach B',values:[90],pointDetails:[{method:'representative_average',valueType:'percentage',count:1,sum:90,representatives:1,numerator:9,denominator:10}]}
      ]};
      const benchmarkSession=AllStarCharts.viewerSession(benchmarkItem,benchmarkResult);benchmarkSession.preferences.benchmark='organization';
    `);
    assert.equal(h.run('AllStarCharts.viewerDataset(benchmarkSession).data.series.find(s=>s.id==="benchmark").points[0].value'),60,'benchmark averages three representatives, not two coach averages or pooled opportunities');
    h.run('benchmarkSession.preferences.hiddenSeries=[AllStarCharts.viewerDataset(benchmarkSession).allSeries[1].id];');
    assert.equal(h.run('AllStarCharts.viewerDataset(benchmarkSession).data.series.find(s=>s.id==="benchmark").points[0].value'),60,'organization benchmark retains hidden coaches in the selected population');
    h.run('benchmarkSession.preferences.benchmark="visible";');
    assert.equal(h.run('AllStarCharts.viewerDataset(benchmarkSession).data.series.find(s=>s.id==="benchmark").points[0].value'),45,'visible-population benchmark intentionally follows legend filtering');
    h.run('benchmarkSession.preferences.hiddenSeries=[];benchmarkResult.data.forEach(r=>r.pointDetails[0].method="weighted_rate");');
    assert.ok(Math.abs(h.run('AllStarCharts.viewerDataset(benchmarkSession).mean')-2600/110)<1e-10);
    h.run('benchmarkResult.data.forEach(r=>delete r.pointDetails);');
    // A fresh result reference prevents reusing the prior cached context.
    h.run('const legacySession=AllStarCharts.viewerSession({...benchmarkItem,id:"legacy"},JSON.parse(JSON.stringify(benchmarkResult)));legacySession.preferences.benchmark="organization";');
    assert.match(h.run('AllStarCharts.viewerDataset(legacySession).benchmarkNote'),/lacks the calculation context/);
    h.run(`
      const captureItem={...benchmarkItem,id:'capture',title:'Weekly coaching review'};
      const captureResult={columns:[{label:'Appointment Rate'}],hasSecondary:true,data:Array.from({length:23},(_,i)=>({label:'2026-09-27',dateValue:Date.UTC(2026,8,27),secondary:'Coach '+String(i+1).padStart(2,'0'),values:[40+i]}))};
      const captureSession=AllStarCharts.viewerSession(captureItem,captureResult),captureContext=()=>AllStarCharts.viewerDataset(captureSession);
      const allCapture=AllStarCharts.captureSurface(captureContext().def,captureContext().data,captureContext(),'presentation');
    `);
    const all=plain(h.run('allCapture'));assert.equal(all.legend.length,23);assert.ok(all.height>=900);
    for(let i=1;i<=23;i++)assert.ok(all.svg.includes('Coach '+String(i).padStart(2,'0')));
    h.run('captureSession.preferences.hiddenSeries=captureContext().allSeries.slice(3).map(s=>s.id);const threeCapture=AllStarCharts.captureSurface(captureContext().def,captureContext().data,captureContext(),"wide");');
    const three=plain(h.run('threeCapture'));assert.equal(three.legend.length,3);
    assert.match(three.svg,/Weekly coaching review/);assert.match(three.svg,/Weekly/);assert.match(three.svg,/2026-09-27/);assert.match(three.svg,/Appointment Rate/);
    assert.doesNotMatch(three.svg,/Coach 04|Coach 23|<button|<aside|<input|data-v-|data-asc-|Edit Research|Fullscreen|Copy Chart/);
    h.run("captureSession.preferences.targetEnabled=true;captureSession.preferences.target=50;captureSession.preferences.trendMode='all';const layerContext=captureContext();const layeredCapture=AllStarCharts.captureSurface(layerContext.def,layerContext.data,layerContext);");
    assert.equal(h.run('layeredCapture.legend.length'),7,'three visible series plus their trends and goal appear in capture legend');
    h.run(`
      const longData={...captureResult,data:captureResult.data.map((r,i)=>({...r,secondary:r.secondary+' '+('Long name with several words '.repeat(i%4+1))}))};
      const longSession=AllStarCharts.viewerSession({...captureItem,id:'long'},longData),longContext=AllStarCharts.viewerDataset(longSession),longCapture=AllStarCharts.captureSurface(longContext.def,longContext.data,longContext);
    `);
    assert.equal(h.run('longCapture.legend.length'),23);assert.ok(h.run('longCapture.height>allCapture.height'),'capture grows to fit wrapped legend names');
    h.run('let downloads=[],imageInput="";AllStarCharts.configure({imageBlob:svg=>{imageInput=svg;return new Blob(["png"],{type:"image/png"});},download:(name,blob,type)=>downloads.push({name,blob,type})});');
    const copied=await h.run('AllStarCharts.copyOrDownloadCapture(threeCapture,"Weekly coaching review",true)');
    assert.match(copied,/PNG downloaded/);assert.equal(h.run('downloads[0].type'),'image/png');assert.equal(h.run('imageInput'),three.svg);
    h.run('let copiedImages=0;navigator.clipboard={write:async values=>{copiedImages=values.length;}};globalThis.ClipboardItem=class{constructor(value){this.value=value;}};');
    assert.equal(await h.run('AllStarCharts.copyOrDownloadCapture(threeCapture,"Review",true)'),'Chart image copied.');assert.equal(h.run('copiedImages'),1);
    h.run('navigator.clipboard.write=async()=>{throw new Error("Denied");};');
    assert.match(await h.run('AllStarCharts.copyOrDownloadCapture(threeCapture,"Review",true)'),/PNG downloaded/);
    assert.equal(h.run('downloads.length'),2);
    assert.deepEqual(h.errors,[]);console.log('PASS representative-consistent benchmarks, visible-only captures, all 23 legend names, expanding layouts, PNG fallback and image clipboard');
  }finally{h.close();}
}
function calendarAndChartCompatibility(){
  const h=fixture(1,1);try{
    h.run(`
      const datedItem={id:'calendar',title:'Weekly result',outputType:'line',dateGrouping:'weekly',source:'weeklyRetail'};
      const weeklyDates=['2026-10-25','2026-11-01','2026-11-08','2026-11-22'];
      const datedResult={columns:[{label:'Value'}],hasSecondary:true,data:weeklyDates.map((date,i)=>({label:date,dateValue:Date.parse(date+'T00:00:00'+(i<2?'-04:00':'-05:00')),secondary:'Coach A',values:[[10,20,30,50][i]]})).concat([{label:'2026-10-25',dateValue:Date.UTC(2026,9,25),secondary:'Coach B',values:[7]}])};
      const datedSession=AllStarCharts.viewerSession(datedItem,datedResult);datedSession.preferences={...datedSession.preferences,rolling:2,previous:true,trendMode:'all'};
      const datedView=AllStarCharts.viewerDataset(datedSession);
    `);
    assert.deepEqual(plain(h.run('datedView.data.series.find(s=>s.id.endsWith("previous week")).points.map(p=>p.value)')),[null,10,20,null],'previous week uses calendar dates across DST and never skips a missing week');
    assert.deepEqual(plain(h.run('datedView.data.series.find(s=>s.id.includes("2-week")).points.map(p=>p.value)')),[10,15,25,50],'moving average respects elapsed weeks, including a missing calendar week');
    assert.deepEqual(plain(h.run('datedView.data.series.find(s=>s.id.endsWith("linear trend")).points.map(p=>p.value)')),[10,20,30,50]);
    h.run('datedSession.preferences.window="custom";datedSession.preferences.start="2026-11-22";datedSession.preferences.end="2026-11-22";const windowView=AllStarCharts.viewerDataset(datedSession);');
    assert.equal(h.run('windowView.allSeries.length'),2,'date inspection retains the full legend and visibility preferences');
    assert.equal(h.run('windowView.allSeries[1].points[0].value'),null);
    h.run(`
      const endResult={columns:[{label:'Value'}],data:['Coach A','Coach B','Coach C'].map(secondary=>({label:'2026-09-27',secondary,values:[45]}))};
      const endSession=AllStarCharts.viewerSession({...datedItem,id:'ends'},endResult);endSession.preferences.endLabelMode="all";const ends=AllStarCharts.viewerDataset(endSession),endSvg=document.createElement('div');endSvg.innerHTML=AllStarCharts.renderSVG(ends.def,ends.data).svg;
      const labelYs=[...endSvg.querySelectorAll('text')].filter(node=>node.querySelector('title')?.textContent.startsWith('Coach')).map(node=>Number(node.getAttribute('y'))).sort((a,b)=>a-b);
    `);
    assert.equal(h.run('labelYs.length'),3);assert.ok(h.run('labelYs[1]-labelYs[0]>=18&&labelYs[2]-labelYs[1]>=18'),'equal endpoint values get separate labels');
    for(const type of ['pie','heatmap','box']){
      h.context.chartType=type;
      h.run(`globalThis.chartInput={columns:[{label:'Value'}],data:[{label:'A',values:[20],box:{min:5,q1:10,median:20,q3:30,max:40,count:7}},{label:'B',values:[30],box:{min:10,q1:20,median:30,q3:40,max:50,count:7}}]};`);
      const svg=h.run('AllStarCharts.renderSVG(AllStarCharts.normalize({type:chartType}, {},chartInput),AllStarCharts.buildDataset({type:chartType},chartInput)).svg');
      assert.match(svg,/<svg/);assert.doesNotMatch(svg,/NaN|Infinity/);
    }
    assert.deepEqual(h.errors,[]);console.log('PASS DST-safe weeks, elapsed-week moving averages, retained legend windows, non-overlapping end labels and existing pie/heatmap/box views');
  }finally{h.close();}
}
(async()=>{await interactiveWorkflow();await benchmarkAndCapture();calendarAndChartCompatibility();})().catch(error=>{console.error(error);process.exitCode=1;});
