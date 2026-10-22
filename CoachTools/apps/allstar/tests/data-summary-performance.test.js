'use strict';
const assert=require('node:assert/strict');
const {createHarness}=require('./modernization-compatibility.test.js');
(async()=>{
  const h=createHarness();
  try{
    h.run(`
      let prohibitedScans=0;
      const coldRows=count=>new Proxy(new Array(count),{get(target,key){if(key===Symbol.iterator||/^\\d+$/.test(String(key))){prohibitedScans++;throw new Error('Opening data controls must not inspect rows');}return Reflect.get(target,key);}});
      state.data.qa={fileName:'large-qa.csv',rows:coldRows(100000),headers:['Agent Name','Team','Score %'],aoa:[]};
      state.data.retail.sv2=coldRows(50000);state.data.retail.controlRoster=coldRows(50000);state.data.retail.headers.sv2=['Representative','Team'];
      state.data.weeklyRetail={fileName:'weekly.xlsx',headers:['Date','Name','Sheet','Consumer Opportunities'],rows:coldRows(120000),config:window.AllStarDatedStats.defaultConfig('weeklyRetail',['Date','Name','Sheet','Consumer Opportunities'])};
      const oldMonthly={dateMode:'dated',importedAt:'2026-08-01',opportunity:{name:'historical.csv',rows:coldRows(50000)},wipers:[]};
      state.data.retail.monthlyBundle=oldMonthly;state.data.retail.monthlyHistory={'2026-08-01_2026-08-31':oldMonthly};
      state.data.retail.monthlySummary={period:{start:'2026-08-01',end:'2026-08-31'},repCount:50000,teamCount:44,managerCount:5,files:[],partial:false};
      state.importCache.meta={savedAt:'2026-10-01',totalRows:270000,sheetCount:1};
      window.CoachToolsMonthly={compile(){prohibitedScans++;throw new Error('Opening data controls must not compile monthly history');}};
      const originalRoster=ensureRosterIndex;ensureRosterIndex=()=>{prohibitedScans++;throw new Error('Opening data controls must not build the roster');};
    `);
    const started=performance.now();
    for(let index=0;index<10;index++)h.run('renderImportWorkspace();');
    await h.run('renderImportCacheStatus()');
    const elapsed=performance.now()-started;
    assert.equal(h.run('prohibitedScans'),0);
    assert.match(h.run("document.querySelector('[data-ds-summary=weeklyRetail]').textContent"),/120,000 rows/);
    assert.match(h.run("document.querySelector('#monthlyHistory').textContent"),/2026-08-01–2026-08-31/);
    assert.equal(h.run('importCacheSourceRowCount()'),270000);
    assert.equal(h.run("importedSourceRowCount('monthly_opportunity')"),null);
    assert.equal(h.run("sourceHasImportedData('monthly_opportunity')"),true);
    console.log(`PASS 10 Update Data renders with 270k rows, 50k roster, historical monthly bundle: zero row reads/roster rebuilds/monthly compiles (${Math.round(elapsed)} ms total)`);
  }finally{h.close();}

  const details=createHarness();
  try{
    details.run(`
      const detailHeaders=['Date','Name','Sheet','Consumer Opportunities'];
      state.data.weeklyRetail={fileName:'weekly.xlsx',headers:detailHeaders,rows:Array.from({length:6000},(_,i)=>({Name:'Person '+String.fromCharCode(65+Math.floor(i%520/26))+String.fromCharCode(65+i%26),Sheet:'Coach '+String.fromCharCode(65+i%5),Date:'2026-09-20','Consumer Opportunities':i%3,_sourceKey:'weeklyRetail'})),config:window.AllStarDatedStats.defaultConfig('weeklyRetail',detailHeaders)};
      const originalRoster=ensureRosterIndex;let rosterLookups=0,uiTicks=0;ensureRosterIndex=(...args)=>{rosterLookups++;return originalRoster(...args);};
      setTimeout(()=>uiTicks++,0);
    `);
    const result=await details.run("weeklySourceHealthAsync('weeklyRetail')");
    assert.equal(result.rows,6000);assert.equal(result.uniqueReps,520);assert.equal(result.coaches.length,5);
    assert.equal(details.run('rosterLookups'),1,'health resolves the roster once, not once for every row');
    assert.ok(details.run('uiTicks')>0,'large identity review yields to the UI');
    details.run('renderDatedStatsImportSummary();');
    assert.equal(await details.run("reviewWeeklySourceDiagnostics('weeklyRetail',document.querySelector('[data-ds-summary=weeklyRetail] [data-weekly-health-result]'))"),true);
    assert.match(details.run("document.querySelector('[data-ds-summary=weeklyRetail]').textContent"),/520 unique representatives/);
    const names=details.run("document.querySelector('[data-source-name-page=unresolvedRepNames]').textContent");
    assert.match(names,/1–100 of 520/,'large diagnostic lists have bounded pages');
    details.run("document.querySelector('[data-source-name-page=unresolvedRepNames] [data-page-next]').click()");
    assert.match(details.run("document.querySelector('[data-source-name-page=unresolvedRepNames]').textContent"),/101–200 of 520/);
    console.log('PASS explicit weekly diagnostics retain all counts and names, yield during review, and reuse one roster context');
  }finally{details.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
