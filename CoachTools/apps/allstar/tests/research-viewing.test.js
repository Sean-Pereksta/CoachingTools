'use strict';
const assert=require('node:assert/strict');
const {createHarness}=require('./modernization-compatibility.test.js');
async function run(){
  const h=createHarness();
  try{
    h.run(`
      window.AllStarResearchWorkspace.init();
      state.data.retail.headers.sv2=['Representative','Coach','Value'];
      state.data.retail.sv2=[{Representative:'Alice Able',Coach:'Coach Alpha',Value:4,_rep:'Alice Able',_repKey:'aliceable',_team:'Coach Alpha',_sourceKey:'retail_sv2'}];
      state.researchItems=[
        {id:'a',title:'Retail trend',source:'retail_sv2',outputType:'line',cardSize:'small',collapsed:true},
        {id:'b',title:'Retail detail',source:'retail_sv2',outputType:'table',cardSize:'large'},
        {id:'c',title:'Quality review',source:'qa',outputType:'table'}
      ].map(normalizeResearchItem);
      const definitionsBeforeViewing=JSON.stringify(state.researchItems);
      openModal('researchModal');renderResearchCanvasShell('Viewing fixture');
      const visibleResearchIds=()=>[...els.researchCanvas.querySelectorAll('[data-research-card]')].filter(card=>!card.hidden).map(card=>card.dataset.researchCard).join(',');
      const chooseResearchView=view=>{el('rwCanvasView').value=view;el('rwCanvasView').dispatchEvent(new Event('change',{bubbles:true}));};
      const escapeResearch=modal=>{const event=new Event('keydown',{bubbles:true,cancelable:true});event.key='Escape';el(modal).dispatchEvent(event);};
    `);
    assert.equal(h.run('visibleResearchIds()'),'a,b,c');
    assert.equal(h.run("document.querySelector('[data-research-card=a] [data-research-size]').closest('details').className"),'rwCardMore','size/export/move controls remain available under More');
    h.run("chooseResearchView('list');");
    assert.equal(h.run('els.researchCanvas.dataset.view'),'list');
    h.run("document.querySelector('#researchModal [data-rw-fullscreen]').click();");
    assert.equal(h.run("els.researchModal.classList.contains('rwWorkspaceFullscreen')"),true);
    h.run("document.querySelector('[data-rw-fullscreen-item=a]').click();");
    assert.equal(h.run('visibleResearchIds()'),'a');
    assert.equal(h.run("document.querySelector('[data-research-card=a]').classList.contains('rwFocusedItem')"),true,'collapsed items are expanded for focused viewing');
    assert.equal(h.run("state.researchItems[0].collapsed"),true,'viewing never rewrites saved collapse/size preferences');
    assert.equal(h.run("el('rwPreviousItem').disabled"),true);
    h.run("el('rwNextItem').click();bindResearchCanvasActions(document.querySelector('[data-research-card=b]'));");
    assert.equal(h.run('visibleResearchIds()'),'b','Next and rebinding preserve individual fullscreen');
    assert.equal(h.run("document.querySelector('[data-rw-fullscreen-item=b]').textContent"),'×');
    h.run("escapeResearch('researchModal');");
    assert.equal(h.run('visibleResearchIds()'),'a,b,c');
    assert.equal(h.run('els.researchCanvas.dataset.view'),'list');
    assert.equal(h.run("els.researchModal.classList.contains('rwWorkspaceFullscreen')"),true,'exiting an item restores the prior workspace fullscreen state');
    h.run("escapeResearch('researchModal');");
    assert.equal(h.run("els.researchModal.classList.contains('rwWorkspaceFullscreen')"),false);
    h.run("document.querySelector('[data-rw-fullscreen-item=c]').click();escapeResearch('researchModal');");
    assert.equal(h.run("els.researchModal.classList.contains('rwWorkspaceFullscreen')"),false,'individual fullscreen also restores a normal workspace');
    assert.equal(h.run('JSON.stringify(state.researchItems)'),h.run('definitionsBeforeViewing'));
    h.run("el('rwResearchSearch').value='retail table';el('rwResearchSearch').dispatchEvent(new Event('input'));chooseResearchView('focus');");
    assert.equal(h.run('visibleResearchIds()'),'b','search matches title, source and chart type');
    assert.equal(h.run("el('rwViewCount').textContent"),'Item 1 of 1');
    h.run("el('rwClearSearch').click();el('rwItemPicker').value='c';el('rwItemPicker').dispatchEvent(new Event('change'));");
    assert.equal(h.run('visibleResearchIds()'),'c','picker opens one selected item without rerunning it');
    h.run("document.querySelector('[data-rw-fullscreen-item=c]').click();el('rwResearchSearch').value='nothing matches';el('rwResearchSearch').dispatchEvent(new Event('input'));");
    assert.equal(h.run('visibleResearchIds()'),'');
    assert.equal(h.run("els.researchModal.classList.contains('rwWorkspaceFullscreen')"),false);
    assert.match(h.run("els.researchCanvas.querySelector('[data-rw-no-matches]').textContent"),/Clear the search/);
    h.run("el('rwClearSearch').click();chooseResearchView('cards');openResearchItemEditor('b');document.querySelector('#researchEditorModal [data-rw-fullscreen]').click();");
    assert.equal(h.run("els.researchEditorModal.classList.contains('rwWorkspaceFullscreen')"),true);
    h.run("escapeResearch('researchEditorModal');");
    assert.equal(h.run("els.researchEditorModal.classList.contains('rwWorkspaceFullscreen')"),false);
    h.run("document.querySelector('#researchEditorModal [data-rw-fullscreen]').click();closeModal('researchEditorModal');");
    assert.equal(h.run("els.researchEditorModal.classList.contains('rwWorkspaceFullscreen')"),false);
    await new Promise(resolve=>setTimeout(resolve,30));
    h.run(`
      state.researchItems=Array.from({length:23},(_,index)=>normalizeResearchItem({id:'chart-'+index,title:'Saved chart '+index,source:'retail_sv2',outputType:'line'}));
      const originalStoredValidity=researchStoredResultValid,originalStoredBody=researchStoredResultBodyAsync,originalDraw=drawResearchCanvasChart;
      researchStoredResultValid=()=>true;
      researchStoredResultBodyAsync=async item=>'<canvas data-research-canvas="'+item.id+'"></canvas>';
      state.researchCanvasCharts=new Map(state.researchItems.map(item=>[item.id,{}]));
      let savedChartDraws=0;drawResearchCanvasChart=()=>savedChartDraws++;
    `);
    await h.run("renderResearchCanvasAsync({reason:'view-performance'})");
    assert.equal(h.run('savedChartDraws'),46,'23 saved cards draw at most twice each, rather than rebinding every card for each insertion');
    assert.equal(h.run('state.researchPerformanceRuns.length'),0,'browsing and fullscreen never launch Research calculations');
    h.run('researchStoredResultValid=originalStoredValidity;researchStoredResultBodyAsync=originalStoredBody;drawResearchCanvasChart=originalDraw;');
    assert.deepEqual(h.errors,[]);
    console.log('PASS Research cards/list/focus, workspace/editor/item fullscreen, Escape/restore, search/picker/navigation, unchanged definitions and linear saved-chart binding');
  }finally{h.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
