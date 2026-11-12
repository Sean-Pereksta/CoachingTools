(function(root){
  'use strict';

  const doc=root.document, STORAGE_KEY='impactTool.coachingSupport.v1';
  const categories=[['needs-support','Needs support','No matching coaching in this review window.'],['stagnant','Supported but stagnant','Follow-up performance has not met the growth threshold.'],['growing','Supported but growing','Follow-up performance meets the growth threshold.'],['follow-up','Awaiting follow-up','More weekly data is needed after the latest coaching.'],['on-track','On track','At goal or maintaining performance after coaching.'],['insufficient','Needs more data','No measurable current KPI is available.']];
  let context=null, scopeKey='', state=null, model=null, mounted=false, opener=null;
  const byId=id=>doc.getElementById(id);
  const percent=value=>Number.isFinite(value)?(value*100).toFixed(1)+'%':'—';
  const pp=value=>Number.isFinite(value)?Math.abs(value*100).toFixed(1)+' pp':'—';
  const signedPp=value=>Number.isFinite(value)?(value>0?'+':value<0?'−':'')+Math.abs(value*100).toFixed(1)+' pp':'Not enough data';
  const count=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:2}):'—';
  function date(value){if(!value)return 'Not recorded';const parsed=new Date(String(value).slice(0,10)+'T12:00:00');return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
  function node(tag,className,text){const result=doc.createElement(tag);if(className)result.className=className;if(text!==undefined)result.textContent=String(text);return result;}
  function readSaved(){try{const saved=JSON.parse(root.localStorage.getItem(STORAGE_KEY)||'{}');return saved&&typeof saved==='object'?saved:{};}catch(_){return {};}}
  function save(){try{const saved=readSaved();saved[scopeKey]={...state};const keys=Object.keys(saved);while(keys.length>20)delete saved[keys.shift()];root.localStorage.setItem(STORAGE_KEY,JSON.stringify(saved));}catch(_){}}
  function defaults(){return {topic:'',coachingType:'',correctiveType:'',correctiveIncident:'',goal:context.goal&&Number.isFinite(context.goal.goal)?String(Number((context.goal.goal*100).toFixed(2))):'',growth:'1',search:'',status:'all',need:'all',correctiveStatus:'all'};}
  function mount(){
    const host=byId('coachingSupportWorkspace');if(!host)return false;
    if(mounted&&byId('supportTopic'))return true;
    host.className='supportWorkspace';
    host.innerHTML=`
      <div class="supportIntro"><div><span class="supportEyebrow">Performance &amp; follow-through</span><h2>Coaching support</h2><p>See who needs help, who is moving forward, and where support has stalled.</p></div><div class="supportAsOf" id="supportAsOf"></div></div>
      <div class="supportControls" aria-label="Coaching analysis settings">
        <label class="supportControl"><span>Coaching topic</span><select id="supportTopic"></select></label>
        <label class="supportControl"><span>Coaching type</span><select id="supportCoachingType"></select></label>
        <label class="supportControl"><span>Corrective type</span><select id="supportCorrectiveType"></select></label>
        <label class="supportControl supportGoalControl"><span>KPI goal</span><div class="supportGoalInput"><input id="supportGoal" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="Not set" aria-describedby="supportGoalHint" /><span>%</span></div></label>
      </div>
      <div class="supportContextRow"><p id="supportScope"></p><details class="supportSettings"><summary>Analysis settings</summary><div><label for="supportGrowthThreshold">Meaningful growth</label><select id="supportGrowthThreshold"><option value="1">1 percentage point</option><option value="2">2 percentage points</option><option value="5">5 percentage points</option></select><span>Required improvement after the latest topic coaching.</span><label for="supportCorrectiveIncident">Corrective incident</label><select id="supportCorrectiveIncident"></select><span>Checklist incidents are filtered separately from coaching topics.</span></div></details></div>
      <p id="supportGoalHint" class="supportValidation" role="status" hidden></p>
      <p id="supportDataNotice" class="supportDataNotice" role="status" hidden></p>
      <div id="supportSummary" class="supportSummary" aria-label="Coaching support groups"></div>
      <div id="supportSecondarySummary" class="supportSecondarySummary"></div>
      <div class="supportFilterbar"><label class="supportSearch"><span>Search people</span><input id="supportSearch" type="search" placeholder="Find a representative…" autocomplete="off" /></label><label><span>Group</span><select id="supportStatus"><option value="all">All groups</option><option value="needs-support">Needs support</option><option value="stagnant">Supported but stagnant</option><option value="growing">Supported but growing</option><option value="follow-up">Awaiting follow-up</option><option value="on-track">On track</option><option value="insufficient">Needs more data</option></select></label><label><span>Level of need</span><select id="supportNeed"><option value="all">All levels</option><option value="high">High · 10+ pp below goal</option><option value="moderate">Moderate · 5–10 pp below</option><option value="low">Low · under 5 pp below</option><option value="at-goal">At goal</option><option value="unknown">Goal or KPI unavailable</option></select></label><label><span>Corrective status</span><select id="supportCorrectiveStatus"><option value="all">All statuses</option><option value="recorded">Selected corrective recorded</option><option value="none">No selected corrective</option><option value="after-support">Corrective since coaching</option></select></label></div>
      <div class="supportResultsMeta"><span id="supportResultCount" role="status" aria-live="polite"></span><button type="button" id="supportResetFilters">Reset view filters</button></div>
      <div id="supportBoard" class="supportBoard"></div>
      <div id="supportOtherGroups" class="supportOtherGroups"></div>
      <details class="supportMethod"><summary>How these groups are calculated</summary><div><p><strong>Current value</strong> is the latest measured week. The window average uses total results divided by total opportunities. <strong>Trend</strong> compares the weighted older half with the weighted newer half of measured weeks.</p><p><strong>Support response</strong> uses records matching both your selected coaching topic and coaching type. It compares complete measured weeks before and after the latest matching coaching in this review window. The coaching week is excluded. Without both a before and an after week, the person stays in Awaiting follow-up. Growing means the improvement meets your selected threshold; stagnant includes flat or declining performance.</p><p><strong>Level of need</strong> is the current gap from the KPI goal: high is 10 or more percentage points below, moderate is 5 to under 10, and low is under 5. A growing person can still have a substantial gap.</p><p><strong>Correctives</strong> use the corrective type and optional incident you explicitly select. Checklist incidents are separate from coaching topics. Open and served records are distinguished. Corrective since coaching means a matching corrective was recorded on or after the latest regular coaching; it describes timing. Documented-coaching correctives must also match the selected topic and do not count as regular coaching.</p><p>These groups describe recorded performance and support. They do not establish that coaching caused a change or that coaching led to a corrective.</p></div></details>
      <dialog id="supportPersonDialog" class="supportDialog" aria-labelledby="supportDialogTitle"><div class="supportDialogHead"><div><span class="supportEyebrow">Representative detail</span><h2 id="supportDialogTitle"></h2><p id="supportDialogSubtitle"></p></div><button type="button" id="supportDialogClose" aria-label="Close representative details">Close <span aria-hidden="true">×</span></button></div><div id="supportDialogBody" class="supportDialogBody"></div></dialog>`;
    [['supportTopic','topic'],['supportCoachingType','coachingType'],['supportCorrectiveType','correctiveType'],['supportCorrectiveIncident','correctiveIncident'],['supportGrowthThreshold','growth'],['supportStatus','status'],['supportNeed','need'],['supportCorrectiveStatus','correctiveStatus']].forEach(([id,key])=>byId(id).addEventListener('change',event=>{state[key]=event.target.value;save();paint();}));
    byId('supportGoal').addEventListener('input',event=>{state.goal=event.target.value;save();paint();});
    byId('supportSearch').addEventListener('input',event=>{state.search=event.target.value;save();paint();});
    byId('supportResetFilters').addEventListener('click',()=>{Object.assign(state,{search:'',status:'all',need:'all',correctiveStatus:'all'});syncControls();save();paint();});
    const dialog=byId('supportPersonDialog');
    const close=()=>{if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');};
    byId('supportDialogClose').addEventListener('click',close);
    dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();}});
    dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();});
    mounted=true;return true;
  }
  function options(select,types,first,current){
    select.replaceChildren();const all=node('option','',first);all.value='';select.appendChild(all);
    const values=types.slice();if(current&&!values.includes(current))values.push(current);
    values.sort((a,b)=>a.localeCompare(b)).forEach(value=>{const option=node('option','',value+(current===value&&!types.includes(value)?' (not present in this view)':''));option.value=value;select.appendChild(option);});select.value=current;
  }
  function syncControls(){
    const types=Array.from(new Set((context.coachings||[]).flatMap(event=>Array.isArray(event.topics)&&event.topics.length?event.topics:Array.isArray(event.types)?event.types:[]).map(String).filter(Boolean)));
    const coachingTypes=Array.from(new Set((context.coachings||[]).map(event=>String(event.coachingType||'')).filter(Boolean)));
    const checklistTypes=Array.from(new Set((context.correctives||[]).map(event=>String(event.correctiveType||'')).filter(Boolean)));
    const incidents=Array.from(new Set((context.correctives||[]).map(event=>String(event.incident||'')).filter(Boolean)));
    options(byId('supportTopic'),types,'All coaching topics',state.topic);
    options(byId('supportCoachingType'),coachingTypes,'All coaching types',state.coachingType);
    options(byId('supportCorrectiveType'),checklistTypes,checklistTypes.length?'None selected':context.checklistLoaded?'No corrective types in this view':'Load Checklist correctives',state.correctiveType);
    byId('supportCorrectiveType').disabled=!checklistTypes.length&&!state.correctiveType;
    options(byId('supportCorrectiveIncident'),incidents,'All corrective incidents',state.correctiveIncident);
    [['supportGoal','goal'],['supportGrowthThreshold','growth'],['supportSearch','search'],['supportStatus','status'],['supportNeed','need'],['supportCorrectiveStatus','correctiveStatus']].forEach(([id,key])=>{byId(id).value=state[key];});
    byId('supportCorrectiveStatus').disabled=!state.correctiveType;
  }
  function filterCategory(category){state.status=state.status===category?'all':category;byId('supportStatus').value=state.status;save();paint();}
  function summary(){
    const primary=byId('supportSummary'),secondary=byId('supportSecondarySummary');primary.replaceChildren();secondary.replaceChildren();
    categories.forEach(([id,label,description],index)=>{const button=node('button',index<3?'supportSummaryCard '+id:'supportSecondaryChip '+id);button.type='button';button.dataset.supportCategory=id;button.setAttribute('aria-pressed',String(state.status===id));
      if(index<3){button.append(node('span','supportSummaryLabel',label),node('strong','',count(model.counts[id]||0)),node('span','supportSummaryDescription',description));primary.appendChild(button);}
      else{button.append(node('strong','',count(model.counts[id]||0)),node('span','',label));secondary.appendChild(button);}
      button.addEventListener('click',()=>filterCategory(id));});
  }
  function svgElement(name,attributes){const element=doc.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(attributes||{}))element.setAttribute(key,String(value));return element;}
  function sparkline(person){
    const series=person.series||[],valid=series.filter(point=>Number.isFinite(point.rate)),svg=svgElement('svg',{viewBox:'0 0 280 52',role:'img','aria-label':'Weekly KPI trend for '+person.rep});svg.classList.add('supportSparkline');
    if(!valid.length){const text=svgElement('text',{x:0,y:30});text.textContent='No measured weekly trend';svg.appendChild(text);return svg;}
    const rates=valid.map(point=>point.rate),lo=Math.min(...rates),hi=Math.max(...rates),span=Math.max(.04,hi-lo),bottom=lo-(span-(hi-lo))/2;
    const x=index=>6+(series.length>1?index/(series.length-1):.5)*268,y=rate=>44-(rate-bottom)/span*36;
    svg.appendChild(svgElement('line',{x1:6,x2:274,y1:46,y2:46,class:'supportSparkBase'}));let segments=[];
    series.forEach((point,index)=>{if(!Number.isFinite(point.rate)){if(segments.length){svg.appendChild(svgElement('polyline',{points:segments.join(' '),class:'supportSparkLine'}));segments=[];}return;}segments.push(x(index).toFixed(2)+','+y(point.rate).toFixed(2));const circle=svgElement('circle',{cx:x(index),cy:y(point.rate),r:2.6,class:'supportSparkPoint'}),title=svgElement('title');title.textContent=point.label+': '+percent(point.rate);circle.appendChild(title);svg.appendChild(circle);});
    if(segments.length)svg.appendChild(svgElement('polyline',{points:segments.join(' '),class:'supportSparkLine'}));return svg;
  }
  function needText(person){if(person.needLevel==='unknown')return 'Goal or KPI unavailable';if(person.needLevel==='at-goal')return 'At goal';return person.needLevel.charAt(0).toUpperCase()+person.needLevel.slice(1)+' need · '+pp(person.needGap)+' below goal';}
  function relevantCorrectives(person){return (person.correctiveEvents||[]).filter(event=>event.source==='checklist'||event.topicMatch!==false);}
  function card(person){
    const article=node('article','supportPerson');article.dataset.rep=person.rep;article.dataset.category=person.category;article.dataset.need=person.needLevel;
    const header=node('div','supportPersonHead'),name=node('button','supportPersonName',person.rep);name.type='button';name.dataset.supportOpen=person.rep;name.addEventListener('click',()=>openDetail(person,name));header.appendChild(name);article.appendChild(header);
    const badge=node('span','supportNeedBadge '+person.needLevel,needText(person));article.appendChild(badge);
    const metric=node('div','supportPersonMetric'),value=node('div');value.append(node('span','supportMetricLabel','Current KPI'),node('strong','supportCurrentValue',percent(person.currentRate)),node('span','supportMetricDate',person.latestWeekLabel||'No measured week'));
    const trend=node('div','supportTrend '+(person.trendDelta>0?'positive':person.trendDelta<0?'negative':'flat'));trend.append(node('strong','',(person.trendDelta>0?'↗ ':person.trendDelta<0?'↘ ':'')+signedPp(person.trendDelta)),node('span','',person.trendLabel||'Window trend'));metric.append(value,trend);article.appendChild(metric);
    article.appendChild(sparkline(person));
    const support=node('div','supportPersonHistory'),supportLabel=node('span','supportHistoryLabel',[state.topic||'Any coaching topic',state.coachingType].filter(Boolean).join(' · '));support.appendChild(supportLabel);
    support.appendChild(node('strong','',person.latestCoaching?date(person.latestCoaching.date):'No matching coaching'));
    support.appendChild(node('span','',count(person.coachingCount||0)+' regular coaching'+(person.coachingCount===1?'':'s')+' in this window'));
    if(Number.isFinite(person.responseDelta))support.appendChild(node('span','supportResponse '+(person.responseDelta>=Number(state.growth)/100?'positive':person.responseDelta<0?'negative':'flat'),'After coaching: '+signedPp(person.responseDelta)));
    else if(person.category==='follow-up')support.appendChild(node('span','supportResponse','Waiting for complete follow-up weeks'));
    article.appendChild(support);
    if(state.correctiveType){
      const matches=relevantCorrectives(person),latest=matches[0],correction=node('div','supportCorrective '+(latest?'recorded':''));
      correction.append(node('span','supportHistoryLabel',state.correctiveType));
      correction.appendChild(node('strong','',latest?(latest.completion||'Recorded')+' · '+date(latest.date):'No selected corrective recorded'));
      if(latest&&person.correctiveAfterSupport)correction.appendChild(node('span','','Recorded since latest coaching'));
      if(!latest&&(person.correctiveEvents||[]).length)correction.appendChild(node('span','','Other-topic record in details'));
      article.appendChild(correction);
    }
    const footer=node('div','supportPersonFooter');footer.appendChild(node('span','',Number.isFinite(person.needGap)?person.belowGoalWeeks+' / '+person.totalMeasuredWeeks+' weeks below goal':person.totalMeasuredWeeks+' measured weeks'));
    const details=node('button','','View details →');details.type='button';details.setAttribute('aria-label','View coaching details for '+person.rep);details.addEventListener('click',()=>openDetail(person,details));footer.appendChild(details);article.appendChild(footer);return article;
  }
  function matches(person){
    if(state.search&&!String(person.rep).toLowerCase().includes(state.search.trim().toLowerCase()))return false;
    if(state.status!=='all'&&person.category!==state.status)return false;
    if(state.need!=='all'&&person.needLevel!==state.need)return false;
    if(state.correctiveType){const has=relevantCorrectives(person).length>0;if(state.correctiveStatus==='recorded'&&!has)return false;if(state.correctiveStatus==='none'&&has)return false;if(state.correctiveStatus==='after-support'&&!person.correctiveAfterSupport)return false;}
    return true;
  }
  function paint(){
    if(!context||!state)return;
    const goalInput=byId('supportGoal'),goalText=String(state.goal).trim(),goalNumber=goalText===''?null:Number(goalText),invalid=goalText!==''&&(!Number.isFinite(goalNumber)||goalNumber<0||goalNumber>100);
    goalInput.setAttribute('aria-invalid',String(invalid));const hint=byId('supportGoalHint');hint.hidden=!invalid;hint.textContent=invalid?'Enter a KPI goal from 0 to 100%, or leave it blank.':'';
    model=root.KpiCoachingSupportCore.analyze({rows:context.rows||[],coachings:context.coachings||[],correctives:context.correctives||[],goal:invalid||goalNumber===null?null:goalNumber/100,topic:state.topic||null,coachingType:state.coachingType||null,correctiveType:state.correctiveType||null,correctiveIncident:state.correctiveIncident||null,growthThresholdPp:Number(state.growth)||1});
    byId('supportAsOf').replaceChildren(node('span','','Data through'),node('strong','',date(model.asOf)));
    byId('supportScope').textContent=(context.coach||'No coach selected')+' · '+(context.sources||'No sources')+' · '+context.weeks+' available weeks · '+model.people.length+' included people'+(context.excludedCount?' · '+context.excludedCount+' excluded':'');
    byId('supportCorrectiveStatus').disabled=!state.correctiveType;summary();
    const dataNotice=byId('supportDataNotice'),notices=[];
    if(context.coachingLoaded===false)notices.push('Documented Coaching is not loaded. Load it to distinguish missing support from missing records.');
    if(context.checklistLoaded===false)notices.push('Load Checklist data to review recorded correctives.');
    dataNotice.hidden=!notices.length;dataNotice.textContent=notices.join(' ');
    const people=model.people.filter(matches).sort((a,b)=>(Number.isFinite(b.needGap)?b.needGap:-1)-(Number.isFinite(a.needGap)?a.needGap:-1)||a.rep.localeCompare(b.rep));
    byId('supportResultCount').textContent=people.length+' of '+model.people.length+' people shown · Current value = latest measured week';
    const board=byId('supportBoard'),other=byId('supportOtherGroups');board.replaceChildren();other.replaceChildren();
    categories.forEach(([id,label,description],index)=>{
      if(state.status!=='all'&&state.status!==id)return;
      const entries=people.filter(person=>person.category===id);if(index>=3&&!entries.length&&state.status==='all')return;
      const lane=node('section','supportLane '+id+(index>=3?' secondary':''));lane.dataset.category=id;const heading=node('div','supportLaneHead'),title=node('h3','',label);heading.append(title,node('span','supportLaneCount',entries.length));lane.appendChild(heading);lane.appendChild(node('p','supportLaneDescription',description));
      const cards=node('div','supportLaneCards');if(!entries.length)cards.appendChild(node('div','supportEmpty',model.people.length?'No people match this group and your filters.':'Load weekly KPI data, then choose a coach to see support needs.'));else entries.forEach(person=>cards.appendChild(card(person)));lane.appendChild(cards);(index<3?board:other).appendChild(lane);
    });
    board.classList.toggle('single',state.status!=='all');
  }
  function detailStat(label,value,sub){const block=node('div','supportDetailStat');block.append(node('span','',label),node('strong','',value));if(sub)block.appendChild(node('small','',sub));return block;}
  function historySection(title,id,events,empty,corrective){
    const section=node('section','supportDetailSection');section.appendChild(node('h3','',title));const list=node('div','supportHistoryList');list.id=id;
    if(!events.length)list.appendChild(node('p','supportDetailEmpty',empty));
    events.forEach(event=>{const entry=node('article','supportHistoryEvent'),head=node('div','supportHistoryEventHead');head.append(node('strong','',date(event.date)),node('span','',corrective?event.correctiveType||(event.types||[]).join(' · '):(event.types||[]).join(' · ')));entry.appendChild(head);if(corrective){entry.appendChild(node('span','supportTopicMatch '+(event.completion==='Open'?'open':event.topicMatch===false?'other':'matching'),event.source==='checklist'?'Checklist · '+(event.completion||'Recorded'):event.topicMatch===false?'Documented coaching · Other topic':'Documented coaching · Matches selected topic'));if(event.incident)entry.appendChild(node('p','supportEventCoach','Incident: '+event.incident));if(event.actionStatus)entry.appendChild(node('p','supportEventCoach','Status: '+event.actionStatus));if(event.createdDate)entry.appendChild(node('p','supportEventCoach','Created '+date(event.createdDate)+(event.servedDate?(event.completion==='Open'&&model.asOf&&event.servedDate>model.asOf?' · Later served ':' · Served ')+date(event.servedDate):'')));}if(event.coach)entry.appendChild(node('p','supportEventCoach','Coach: '+event.coach));entry.appendChild(node('p','supportEventNotes',event.desc||'No notes recorded.'));list.appendChild(entry);});section.appendChild(list);return section;
  }
  function openDetail(person,button){
    const dialog=byId('supportPersonDialog'),body=byId('supportDialogBody');opener=button;byId('supportDialogTitle').textContent=person.rep;
    byId('supportDialogSubtitle').textContent=person.categoryLabel+' · '+needText(person);body.replaceChildren();
    const stats=node('div','supportDetailStats');stats.append(detailStat('Current KPI',percent(person.currentRate),person.latestWeekLabel||'No measured week'),detailStat('Window average',percent(person.windowRate),'Weighted by opportunities'),detailStat('Window trend',signedPp(person.trendDelta),person.trendLabel),detailStat('Gap to goal',Number.isFinite(person.needGap)?pp(person.needGap):'Goal not set',person.needLevel==='at-goal'?'At or above goal':needText(person)));body.appendChild(stats);
    const response=node('section','supportResponseDetail');response.append(node('h3','','Since the latest topic coaching'),node('p','',person.categoryReason||(person.reasons||[]).join(' ')));
    const comparison=node('div','supportComparison');comparison.append(detailStat('Before',percent(person.preRate),(person.responseSample?.beforeWeeks||0)+' measured weeks'),detailStat('After',percent(person.postRate),(person.responseSample?.afterWeeks||0)+' measured weeks'),detailStat('Change',signedPp(person.responseDelta),'Growth threshold: '+state.growth+' pp'));response.appendChild(comparison);response.appendChild(node('p','supportDetailNote','Complete weeks before and after the latest regular coaching are compared. The coaching week is excluded. A performance change does not establish cause.'));body.appendChild(response);
    body.appendChild(historySection('Topic coaching history'+(state.topic?' · '+state.topic:'')+(state.coachingType?' · '+state.coachingType:''),'supportTopicHistory',person.coachingEvents||[],'No matching regular coaching was recorded in this review window.',false));
    body.appendChild(historySection('Corrective history'+(state.correctiveType?' · '+state.correctiveType:''),'supportCorrectiveHistory',person.correctiveEvents||[],state.correctiveType?'No records match the selected corrective type in this review window.':'Select a corrective type to inspect recorded escalation.',true));
    const weekly=node('section','supportDetailSection');weekly.appendChild(node('h3','','Weekly performance'));const wrap=node('div','supportWeeklyWrap'),table=node('table','supportWeeklyTable'),head=node('thead'),headRow=node('tr');['Week','KPI value','Results / opportunities'].forEach(text=>{const th=node('th','',text);th.scope='col';headRow.appendChild(th);});head.appendChild(headRow);table.appendChild(head);const tbody=node('tbody');(person.series||[]).forEach(point=>{const row=node('tr');row.append(node('td','',point.label),node('td','',percent(point.rate)),node('td','',count(point.apps)+' / '+count(point.opps)));tbody.appendChild(row);});table.appendChild(tbody);wrap.appendChild(table);weekly.appendChild(wrap);body.appendChild(weekly);
    if(typeof context.onOpen==='function'){const original=node('button','supportFullHistory','Open full representative coaching history');original.type='button';original.addEventListener('click',()=>{if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');context.onOpen(person.rep);});body.appendChild(original);}
    if(typeof dialog.showModal==='function'){if(!dialog.open)dialog.showModal();}else dialog.setAttribute('open','');byId('supportDialogClose').focus();
  }
  function render(next){
    context=next;if(!mount())return;
    const nextKey=JSON.stringify([context.coach||'',context.metricKey||context.goal?.label||'']);
    if(nextKey!==scopeKey){scopeKey=nextKey;const preset=defaults(),saved=readSaved()[scopeKey];state={...preset};if(saved&&typeof saved==='object'){for(const key of Object.keys(preset))if(typeof saved[key]==='string')state[key]=saved[key];}if(!categories.some(item=>item[0]===state.status)&&state.status!=='all')state.status='all';if(!['all','high','moderate','low','at-goal','unknown'].includes(state.need))state.need='all';if(!['all','recorded','none','after-support'].includes(state.correctiveStatus))state.correctiveStatus='all';if(!['1','2','5'].includes(state.growth))state.growth='1';}
    syncControls();paint();
  }
  root.KpiCoachingSupport=Object.freeze({render});
})(window);
