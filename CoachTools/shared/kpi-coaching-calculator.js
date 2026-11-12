(function(root){
  'use strict';
  const doc=root.document, key='impactTool.calculator.v1';
  let context=null, scopeKey='', state={target:'',mode:'below',selected:[]};
  const byId=id=>doc.getElementById(id);
  const number=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
  const percent=value=>Number.isFinite(value)?(value*100).toFixed(1)+'%':'—';
  function save(){try{root.localStorage.setItem(key,JSON.stringify({scopeKey,...state}));}catch(e){}}
  function selectedNames(rows){
    if(state.mode==='all') return rows.map(r=>r.rep);
    if(state.mode==='below') return rows.filter(r=>r.opps>0 && r.apps/r.opps < Number(state.target)/100).map(r=>r.rep);
    return state.selected;
  }
  function cell(row,text,className){const td=doc.createElement('td');td.textContent=text;if(className)td.className=className;row.appendChild(td);return td;}
  function paint(){
    if(!context)return;
    const rows=context.team.byRep, target=byId('teamTargetPercent');
    const names=selectedNames(rows), result=root.KpiTargetPlanner.plan(rows,state.target,names);
    target.setAttribute('aria-invalid',String(!result.ok && result.code==='invalid-target'));
    byId('calculatorUseGoal').disabled=!context.goal;
    byId('calculatorUseGoal').textContent=context.goal?'Use KPI goal ('+percent(context.goal.goal)+')':'No mapped KPI goal';
    byId('calculatorSelectionCount').textContent=names.filter(name=>rows.some(r=>r.rep===name)).length+' of '+rows.length+' included reps selected for coaching.';
    const output=byId('calculatorResult');output.replaceChildren();
    if(result.ok){
      const stats=doc.createElement('div');stats.className='calculatorResultStats';
      [['Current team rate',percent(result.currentRate)],['Extra results needed',number(result.needed)],['Planned team rate',percent(result.projectedRate)]].forEach(([label,value])=>{const block=doc.createElement('div');block.className='calculatorStat';const caption=doc.createElement('span');caption.textContent=label;const strong=doc.createElement('strong');strong.textContent=value;block.append(caption,strong);stats.appendChild(block);});output.appendChild(stats);
    }
    const message=doc.createElement('p');message.className='calculatorMessage';
    if(!result.ok){message.classList.add('warn');message.textContent=result.error;}
    else if(result.needed===0){message.classList.add('good');message.textContent='Your team already meets the '+percent(result.targetRate)+' target. No extra results are needed.';}
    else if(!result.selectedCount){message.classList.add('warn');message.textContent='Select at least one representative to build a coaching plan. Your team needs '+number(result.needed)+' extra results to reach '+percent(result.targetRate)+'.';}
    else if(!result.possible){message.classList.add('warn');message.textContent='The selected reps can add up to '+number(result.capacity)+' results at this opportunity volume. The plan is '+number(result.shortfall)+' results short of your target. Select more reps or lower the target.';}
    else{message.classList.add('good');message.textContent='Aim for '+number(result.needed)+' extra results across the selected reps. That takes the team from '+percent(result.currentRate)+' to '+percent(result.projectedRate)+' with the same '+number(result.totalOpps)+' opportunities. Use the suggested targets below.';}
    output.appendChild(message);
    if(result.ok){
      const counts=doc.createElement('p');counts.className='calculatorExactCounts';
      counts.textContent='Current results: '+number(result.totalApps)+' / '+number(result.totalOpps)+'. Planned results: '+number(result.totalApps+result.allocated)+' / '+number(result.totalOpps)+'. Percentages above are rounded for display.';
      output.appendChild(counts);
    }
    const body=byId('calculatorRepRows');body.replaceChildren();
    const planned=new Map((result.rows||[]).map(r=>[r.rep,r]));
    rows.slice().sort((a,b)=>a.rep.localeCompare(b.rep)).forEach(r=>{
      const p=planned.get(r.rep), tr=doc.createElement('tr'), td=doc.createElement('td'), input=doc.createElement('input');
      input.type='checkbox';input.checked=names.includes(r.rep);input.setAttribute('aria-label','Coach '+r.rep);input.dataset.rep=r.rep;
      input.addEventListener('change',()=>{
        const selection=new Set(selectedNames(rows));if(input.checked)selection.add(r.rep);else selection.delete(r.rep);
        state.mode='custom';state.selected=[...selection];save();paint();
        [...body.querySelectorAll('input')].find(node=>node.dataset.rep===r.rep)?.focus();
      });td.appendChild(input);tr.appendChild(td);
      cell(tr,r.rep);cell(tr,percent(r.opps>0?r.apps/r.opps:NaN));cell(tr,number(r.apps)+' / '+number(r.opps));
      cell(tr,p?'+'+number(p.extra):'—','plannedExtra');cell(tr,p?percent(p.targetRate):'—');body.appendChild(tr);
    });
    if(!rows.length){const tr=doc.createElement('tr'),td=cell(tr,'Load weekly data and choose a coach and KPI to start.');td.colSpan=6;body.appendChild(tr);}
  }
  function render(next){
    context=next;
    const nextKey=JSON.stringify([next.coach,next.set?.A,next.set?.B,next.weeks,next.sources]);
    if(nextKey!==scopeKey){
      scopeKey=nextKey;state={target:next.goal?String(Number((next.goal.goal*100).toFixed(2))):'',mode:'below',selected:[]};
      try{const saved=JSON.parse(root.localStorage.getItem(key)||'null');if(saved?.scopeKey===scopeKey){state={target:typeof saved.target==='string'?saved.target:state.target,mode:['all','below','custom'].includes(saved.mode)?saved.mode:'below',selected:Array.isArray(saved.selected)?saved.selected:[]};}}catch(e){}
      byId('teamTargetPercent').value=state.target;
    }
    byId('calculatorScope').textContent=(next.coach||'No coach selected')+' · '+(next.sources||'No sources')+' · Last '+next.weeks+' available weeks · '+next.team.byRep.length+' included reps'+(next.excludedCount?' · '+next.excludedCount+' excluded':'')+'. Uses the included team totals above; search and attendance filters only change the displayed views.';
    byId('calculatorTargetHint').textContent=next.set?'Planning '+next.set.A+' ÷ '+next.set.B+'. Enter a target from 0 to 100%.':'Choose a KPI above, then enter your target.';
    paint();
  }
  byId('teamTargetPercent').addEventListener('input',event=>{state.target=event.target.value;save();paint();});
  byId('calculatorUseGoal').addEventListener('click',()=>{if(context?.goal){state.target=String(Number((context.goal.goal*100).toFixed(2)));byId('teamTargetPercent').value=state.target;save();paint();}});
  [['calculatorBelowTarget','below'],['calculatorSelectAll','all'],['calculatorSelectNone','custom']].forEach(([id,mode])=>byId(id).addEventListener('click',()=>{state.mode=mode;state.selected=[];save();paint();}));
  root.KpiCoachingCalculator={render};
})(window);
