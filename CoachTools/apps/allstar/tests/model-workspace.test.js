'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const h=createHarness();
try{
  h.run('window.AllStarModelWorkspace.init(); openEditModel(state.models.find(m=>m.criteria.length>1).id);');
  assert.ok(h.run('document.getElementById("modelWorkspace")'));
  assert.ok(h.run('document.getElementById("modelWorkspaceSummary").textContent.includes("criteria")'));
  assert.match(h.run('window.AllStarModelWorkspace.describe({source:"qa",customSource:"retail_sv2",calcType:"qaScore",scoreType:"rank"})'),/QA/);
  h.run('const beforeOrder=state.editModel.criteria.map(c=>c.id); window.AllStarModelWorkspace.moveCriterion(state.editModel,beforeOrder[0],1);');
  assert.equal(h.run('state.editModel.criteria[1].id===beforeOrder[0]'),true);
  assert.equal(h.run('window.AllStarModelWorkspace.moveCriterion(state.editModel,state.editModel.criteria[0].id,-1)'),false);
  assert.equal(h.run('findModel(state.editModel.id).criteria[0].id===beforeOrder[0]'),true,'reordering the editor does not mutate the saved model');
  h.run('renderEditModel(); document.getElementById("modelCriterionSearch").value="no-such-criterion"; document.getElementById("modelCriterionSearch").oninput();');
  assert.equal(h.run('[...els.criteriaList.querySelectorAll("[data-crit]")].every(row=>row.hidden)'),true);
  h.run('document.getElementById("modelCriterionSearch").value=""; document.getElementById("modelCriterionSearch").oninput();');
  assert.equal(h.run('[...els.criteriaList.querySelectorAll("[data-crit]")].every(row=>!row.hidden)'),true);
  console.log('PASS model section navigation, source explanations, isolated reordering, and reversible criterion search');
}finally{h.close();}

async function integration(){
  const app=createHarness();
  try{
    app.run(`
      window.AllStarModelWorkspace.init();
      state.data.retail.headers.sv2=['Representative','Team','Metric','Opportunities','Label'];
      state.data.retail.sv2=[
        {Representative:'Alice Able',Team:'Alpha',Metric:10,Opportunities:2,Label:'First'},
        {Representative:'Bob Baker',Team:'Alpha',Metric:30,Opportunities:10,Label:'Second'}
      ].map(row=>({...row,_rep:row.Representative,_repKey:fullNameIdentityKey(row.Representative),_team:row.Team,_sourceKey:'retail_sv2'}));
      state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('workspace integration',{sources:['retail_sv2']});rebuildDataIndexSync('workspace integration');
      state.models.push(normalizeModelForStorage({id:'workspace-model',name:'Workspace Example',criteria:[
        {...emptyCriterion(),id:'numeric',name:'Revenue & appointments',column:'Metric',aggregate:'sum'},
        {...emptyCriterion(),id:'team-ratio',name:'Team conversion',audience:'team',calcType:'multi',leftColumn:'Metric',rightColumn:'Opportunities'},
        {...emptyCriterion(),id:'display',name:'Display label',calcType:'displayColumn',lookupMatchColumn:'Representative',lookupReturnColumn:'Label',lookupSelection:'first'}
      ]}));
      openEditModel('workspace-model');
    `);
    for(const [criterionId,title,grain,expected] of [
      ['numeric','Revenue & appointments','representatives',[['Alice Able',10],['Bob Baker',30]]],
      ['team-ratio','Team conversion','teams',[['Alpha',40/12]]],
      ['display','Display label','representatives',[['Alice Able','First'],['Bob Baker','Second']]]
    ]){
      const errorCount=app.errors.length;
      app.run(`els.criteriaList.querySelector('[data-crit="${criterionId}"] [data-model-research]').dispatchEvent(new Event('click',{bubbles:true}));`);
      assert.equal(app.errors.length,errorCount,'saved model shortcut should open without asking to save again');
      assert.equal(app.run('els.researchEditorModal.classList.contains("open")'),true);
      const item=plain(app.run('currentResearchItemFromEditor()'));
      assert.equal(item.title,'Workspace Example — '+title);
      assert.equal(item.columns.length,1);
      assert.equal(item.columns[0].label,title);
      assert.equal(item.columns[0].field,`model("workspace-model","${criterionId}")`);
      assert.equal(item.analysisGrain,grain);
      assert.deepEqual(item.guidedConditions,[]);
      assert.deepEqual(item.guidedEvidenceSources,['retail_sv2'],'shortcut must not retain unrelated default guided evidence');
      const output=await app.run('evaluateResearchItemAsync(currentResearchItemFromEditor())');
      assert.deepEqual(plain(output.data.map(row=>[row.label,row.values[0]])),expected,criterionId+' shortcut returns the actual criterion value');
      assert.deepEqual(plain(output.warnings),[],criterionId+' should not introduce source or numeric warnings');
      await app.run('saveResearchItemFromEditor()');
      assert.equal(app.run('els.researchEditorModal.classList.contains("open")'),false,'valid shortcut saves normally');
      const saved=JSON.parse(app.storage.get('allStarResearchItems.v1')).find(research=>research.id===item.id);
      assert.ok(saved,'shortcut is stored in the existing Research key');
      assert.equal(saved.columns[0].field,item.columns[0].field);
      app.context.reopenId=item.id;
      app.run('openResearchItemEditor(reopenId);');
      const reopened=await app.run('evaluateResearchItemAsync(currentResearchItemFromEditor())');
      assert.deepEqual(plain(reopened.data.map(row=>[row.label,row.values[0]])),expected,'saved/reopened shortcut preserves model and result semantics');
      app.run('closeModal("researchEditorModal");');
    }
    app.run(`
      const previewModel=normalizeModelForStorage({id:'preview-model',name:'Preview Example',criteria:[{...emptyCriterion(),id:'preview-value',name:'Metric',column:'Metric',scoreType:'points',points:1}]});
      state.models.push(previewModel);openEditModel('preview-model');
      state.editModel.criteria[0].points=2;renderEditModel();
    `);
    await app.run('window.AllStarModelWorkspace.preview()');
    assert.deepEqual(plain(app.run('[...document.querySelectorAll("#modelSamplePreviewResult tbody tr")].map(row=>[...row.querySelectorAll("td")].map(cell=>cell.textContent))')),[['Alice Able','1','20.00','Qualifying'],['Bob Baker','2','60.00','Qualifying']]);
    assert.equal(app.run('findModel("preview-model").criteria[0].points'),1,'sample preview must not persist unsaved changes');
    app.run(`state.editModel.criteria[0].audience='team';renderEditModel();`);
    await app.run('window.AllStarModelWorkspace.preview()');
    assert.deepEqual(plain(app.run('[...document.querySelectorAll("#modelSamplePreviewResult tbody tr")].map(row=>[...row.querySelectorAll("td")].map(cell=>cell.textContent))')),[['Alpha','1','80.00','Qualifying']]);
    assert.equal(app.run('document.getElementById("modelSamplePreviewBtn").disabled'),false);
    console.log('PASS actual Model-to-Research shortcuts, numeric/team/display semantics, persisted reopening, and isolated representative/team sample previews');
  }finally{app.close();}
}
integration().catch(error=>{console.error(error);process.exitCode=1;});
