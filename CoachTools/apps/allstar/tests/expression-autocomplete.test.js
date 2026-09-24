'use strict';
const assert=require('node:assert/strict');
const {createHarness,plain}=require('./modernization-compatibility.test.js');
const h=createHarness();
try{
  h.run(`
    state.data.retail.headers.sv2=['Representative','Team','X','Y','Z','A','B','C','D','X Value','Y Value'];
    state.data.retail.sv2=[{Representative:'Test Rep',Team:'Alpha',X:12,Y:3,Z:5,A:2,B:4,C:3,D:3,'X Value':12,'Y Value':3,_rep:'Test Rep',_repKey:fullNameIdentityKey('Test Rep'),_team:'Alpha',_sourceKey:'retail_sv2'}];
    state.sourceMeta.retail_sv2={sourceVersion:1};markDataIndexDirty('expression fixture',{sources:['retail_sv2']});buildDataIndex('expression fixture');
    const fixtureItem=normalizeResearchItem({id:'formula-fixture',title:'Formula fixture',source:'retail_sv2',analysisGrain:'rows',groupField:'Team',columns:[{mode:'expression',field:'X / Y'}]});
    state.metrics=[normalizeMetric({id:'saved-x',name:'Saved X',source:'retail_sv2',mode:'sum',field:'X',gear:{valuesEnabled:false}})];
    state.models=[normalizeModelForStorage({id:'cash-model',name:'Cash Model',type:'both',criteria:[{...emptyCriterion(),id:'x',name:'Cash Apps',source:'retail_sv2',column:'X',aggregate:'sum'},{...emptyCriterion(),id:'y',name:'Cash Opps',source:'retail_sv2',column:'Y',aggregate:'sum'}]})];
  `);
  for(const [formula,expected] of [['X / Y',4],['(X + Y) / Z',3],['(X + Y) / (Z + A)',15/7],['[X Value] / [Y Value]',4],['([A] + [B]) / ([C] + [D])',1],['sum([X]) / sum([Y])',4],['@Saved X / [Y]',4],['model("Cash Model","Cash Apps") / model("Cash Model","Cash Opps")',4]]){
    h.context.formula=formula;
    assert.equal(h.run('evaluateResearchAggregateExpression(fixtureItem,state.data.retail.sv2,formula)'),expected,formula);
    const result=h.run(`evaluateResearchItem({...fixtureItem,columns:[{field:formula,mode:'expression'}]})`);
    assert.equal(result.data[0].values[0],expected,'table execution: '+formula);
  }
  assert.equal(h.run(`evaluateResearchAggregateExpression(fixtureItem,state.data.retail.sv2,'X / 0')`),0);
  assert.equal(h.run(`evaluateResearchAggregateExpression({...fixtureItem,zeroDenominator:'blank'},state.data.retail.sv2,'X / 0')`),null);
  h.run(`const warnings=[];evaluateResearchAggregateExpression(fixtureItem,state.data.retail.sv2,'[Missing Header] / Y',{warnings});`);
  assert.ok(h.run(`warnings.some(x=>x.includes('Missing Header'))`));
  for(const [value,pos,expected] of [['[X Value] / [Y]',4,'[A] / [Y]'],['X-Y',1,'[A]-Y'],['(X + Y) / Z',6,'(X + [A]) / Z'],['@Saved X / Y',5,'[A] / Y']]){
    h.context.value=value;h.context.pos=pos;
    h.run(`const testInput=document.createElement('textarea');testInput.value=value;testInput.selectionStart=pos;testInput.selectionEnd=pos;testInput.focus=()=>{};testInput.setSelectionRange=()=>{};insertHeaderIntoExpression(testInput,expressionTokenInfo(testInput),{kind:'header',label:'A',source:'retail_sv2'},'retail_sv2');` .replaceAll('const testInput','var testInput'));
    assert.equal(h.run('testInput.value'),expected);
  }
  console.log('PASS actual Research expression execution, metrics/models, diagnostics, zero denominator and caret insertion');
}finally{h.close();}
