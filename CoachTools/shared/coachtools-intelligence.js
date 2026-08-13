(function attachCoachToolsIntelligence(root) {
  'use strict';

  const VERSION = '1.0.0';
  const DAY = 86400000;
  const CACHE_MS = 45000;
  const cache = new Map();

  const METRICS = Object.freeze([
    { id:'referral-appointment-rate', name:'Referral Appointment Rate', pattern:/referral.*(appointment|appt).*rate/i, topic:/appointment|appt|referral/i, higher:true, percent:true },
    { id:'consumer-appointment-rate', name:'Consumer Appointment Rate', pattern:/(consumer|cash).*(appointment|appt).*rate|(^|[^a-z])car([^a-z]|$)/i, topic:/appointment|appt|cash/i, higher:true, percent:true },
    { id:'appointment-rate', name:'Appointment Rate', pattern:/(appointment|appt).*rate/i, topic:/appointment|appt/i, higher:true, percent:true },
    { id:'call-quality', name:'Call Quality', pattern:/call.*quality|quality.*score/i, topic:/call.*quality|quality|qa/i, higher:true, percent:true },
    { id:'wiper-rate', name:'Wiper Rate', pattern:/wiper.*rate|wipers|vaps/i, topic:/wiper|vaps/i, higher:true, percent:true },
    { id:'afterpay', name:'Afterpay', pattern:/afterpay/i, topic:/afterpay/i, higher:true, percent:true },
    { id:'save-the-sale', name:'Save the Sale', pattern:/save.*sale/i, topic:/save.*sale/i, higher:true, percent:true },
    { id:'insurance-cash', name:'Insurance Cash', pattern:/insurance.*cash/i, topic:/insurance.*cash/i, higher:true, percent:true },
    { id:'solution-rate', name:'Solution Rate', pattern:/solution.*rate/i, topic:/solution/i, higher:true, percent:true },
    { id:'aht', name:'Average Handle Time', pattern:/\baht\b|average.*handle.*time/i, topic:/handle.*time|aht/i, higher:false, percent:false }
  ]);

  const IDENTITY_HEADERS = new Set([
    'sheet','team','department','coach','jobcoach','coachassigned','representative','associatename','agentname','agent','name','employee',
    'date','day','week','month','coordinator','manager','supervisor','count','calls','opportunities','volume','sample','samplesize'
  ]);

  function clean(value){ return String(value == null ? '' : value).trim().replace(/\s+/g,' '); }
  function norm(value){ return clean(value).toLowerCase().replace(/[^a-z0-9%]/g,''); }
  function normalizeName(value){
    if(root.CoachToolsIdentity && typeof root.CoachToolsIdentity.normalizeName === 'function') return root.CoachToolsIdentity.normalizeName(value);
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function mean(values){ const valid=(values||[]).filter(Number.isFinite); return valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : NaN; }
  function median(values){ const valid=(values||[]).filter(Number.isFinite).sort((a,b)=>a-b); if(!valid.length) return NaN; const i=(valid.length-1)/2; return (valid[Math.floor(i)]+valid[Math.ceil(i)])/2; }
  function clamp(value,low,high){ return Math.max(low,Math.min(high,value)); }
  function daysSince(date){ return date instanceof Date ? Math.max(0,(Date.now()-date.getTime())/DAY) : NaN; }
  function formatPercent(value){ return Number.isFinite(value) ? `${(value*100).toFixed(Math.abs(value)<0.1?1:0)}%` : '—'; }
  function formatDays(value){ return Number.isFinite(value) ? `${value.toFixed(value<10?1:0)} days` : '—'; }

  function parseNumber(value){
    if(value==null || value==='') return NaN;
    if(typeof value==='number') return Number.isFinite(value)?value:NaN;
    const raw=clean(value), numeric=Number(raw.replace(/[$,%]/g,'').replace(/,/g,''));
    if(!Number.isFinite(numeric)) return NaN;
    return raw.includes('%') ? numeric/100 : numeric;
  }
  function parseDate(value){
    if(value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if(typeof value==='number' && value>0 && value<100000) return new Date(Date.UTC(1899,11,30)+value*DAY);
    if(typeof value==='number' && value>1e11) return new Date(value);
    const raw=clean(value); if(!raw) return null; const date=new Date(raw); return Number.isNaN(date.getTime())?null:date;
  }
  function pick(row,candidates){
    const map=new Map(Object.keys(row||{}).map(key=>[norm(key),key]));
    for(const candidate of candidates){ const key=map.get(norm(candidate)); if(key!=null) return row[key]; }
    return undefined;
  }
  function rowsFromAoa(aoa){
    if(!Array.isArray(aoa)) return [];
    const signals=['sheet','team','jobcoach','coachassigned','associatename','representative','agentname','score%','action','date','createdon'];
    let best={index:-1,score:0,header:[]};
    for(let i=0;i<Math.min(60,aoa.length);i++){
      const header=Array.isArray(aoa[i])?aoa[i].map(clean):[];
      const keys=header.map(norm), score=signals.filter(signal=>keys.includes(norm(signal))).length;
      if(score>best.score) best={index:i,score,header};
    }
    if(best.index<0 || !best.score) return [];
    return aoa.slice(best.index+1).map(values=>Object.fromEntries(best.header.map((header,index)=>[header,Array.isArray(values)?values[index]:'']).filter(([header])=>header))).filter(row=>Object.values(row).some(value=>clean(value)));
  }
  function extractRows(dataset){
    const packs=[], seen=new Set();
    function push(rows,sheet){
      if(!Array.isArray(rows)||!rows.length) return;
      const values=Array.isArray(rows[0])?rowsFromAoa(rows):rows;
      if(!values.length) return;
      const key=`${sheet}|${values.length}|${Object.keys(values[0]).join('|')}`;
      if(seen.has(key)) return; seen.add(key); packs.push({sheet:sheet||'',rows:values});
    }
    function walk(node,sheet){
      if(node==null) return;
      if(Array.isArray(node)){ push(node,sheet); return; }
      if(typeof node!=='object') return;
      if(Array.isArray(node.aoa)) push(node.aoa,sheet);
      if(Array.isArray(node.rows)) push(node.rows,sheet);
      if(node.workbook && node.workbook.data) for(const [name,value] of Object.entries(node.workbook.data)) walk(value,name);
      if(node.sheets && typeof node.sheets==='object' && !Array.isArray(node.sheets)) for(const [name,value] of Object.entries(node.sheets)) walk(value,name);
    }
    walk(dataset,''); return packs;
  }

  function recordDate(record){
    if(!record) return null;
    const period=record.detectedPeriod||{};
    return parseDate(period.end||period.start||period.date||record.periodSort||record.importedAt||record.updatedAt);
  }
  function resolverFor(people){
    const exact=new Map();
    for(const person of people||[]){
      for(const value of [person.displayName,person.normalizedName,...(person.aliases||[])]){
        const key=normalizeName(value); if(key && !exact.has(key)) exact.set(key,person.personId);
      }
    }
    return value=>exact.get(normalizeName(value))||'';
  }
  function splitTopics(value){ return clean(value).split(/[,;|]+/).map(clean).filter(Boolean); }

  function canonicalizeCoaching(record,resolve){
    const events=[];
    for(const pack of extractRows(record&&record.data)) for(const row of pack.rows){
      const coach=pick(row,['Job Coach','Coach Assigned','Coach','Sheet','Team']);
      const rep=pick(row,['Associate Name','Associate','Representative','Agent Name','Name','Employee']);
      const date=parseDate(pick(row,['Date','Coaching Date','Day','Created On']));
      const topics=[...splitTopics(pick(row,['Coaching Type Multi'])),...splitTopics(pick(row,['Coaching Type','Type','Topic']))];
      if(!date || !clean(coach) || !topics.length) continue;
      events.push({
        coachId:resolve(coach), coach:clean(coach), representativeId:resolve(rep), representative:clean(rep), date,
        topics:Array.from(new Set(topics)), description:clean(pick(row,['Description','Notes','Details','Summary','Coaching Notes']))
      });
    }
    return events;
  }

  function canonicalizeChecklist(record,resolve){
    const items=[];
    for(const pack of extractRows(record&&record.data)) for(const row of pack.rows){
      const coach=pick(row,['Coach Assigned','Job Coach','Coach','Sheet','Team']);
      const rep=pick(row,['Associate Name','Associate','Representative','Agent Name','Name','CSR Name','SSR Name']);
      const created=parseDate(pick(row,['Created On','Created','Created At','Created Date','Created Date Time','Date']));
      const served=parseDate(pick(row,['Date Served','Served Date','Date Completed','Completed On','Date Serviced','Addressed Date']));
      if(!created || !clean(coach) || !clean(rep)) continue;
      const days=served?(served.getTime()-created.getTime())/DAY:NaN;
      items.push({
        coachId:resolve(coach), coach:clean(coach), representativeId:resolve(rep), representative:clean(rep), created, served, days,
        action:clean(pick(row,['Action Taken','Action','Status']))|| (served?'Served':'Open'),
        incident:clean(pick(row,['Incident','Incident Type','Incident Category','Type','Checklist Item']))||'(unspecified)',
        description:clean(pick(row,['Description','Details','Notes','Summary']))
      });
    }
    return items;
  }

  function canonicalizeQA(record,resolve){
    const rows=[];
    for(const pack of extractRows(record&&record.data)) for(const row of pack.rows){
      const rep=pick(row,['Agent Name','Agent','CSR','Associate','Representative','Rep','Name']);
      let score=parseNumber(pick(row,['Score %','Score Pct','Score','QA Score','QA %']));
      const date=parseDate(pick(row,['Interaction Start Time','Interaction Start','Start Time','Interaction Time','Assigned Date','Date']));
      const team=pick(row,['Team','Sheet','Department','Group','Supervisor','Manager','Coach']);
      if(!clean(rep)||!Number.isFinite(score)||!date) continue;
      if(Math.abs(score)>1.5) score/=100;
      rows.push({representativeId:resolve(rep),representative:clean(rep),coachId:resolve(team),team:clean(team),score,date});
    }
    return rows;
  }

  function metricForHeader(header){ return METRICS.find(metric=>metric.pattern.test(clean(header)))||null; }
  function canonicalizePerformance(record,resolve,type){
    const observations=[], date=recordDate(record);
    if(!record || !date) return observations;
    for(const pack of extractRows(record.data)) for(const row of pack.rows){
      const rep=pick(row,['Representative','Associate Name','Agent Name','AgentName','Employee','Name']);
      const coach=pick(row,['Job Coach','Coach Assigned','Coach','Sheet','Team']);
      const personId=rep?resolve(rep):resolve(coach); if(!personId) continue;
      for(const [header,raw] of Object.entries(row)){
        if(IDENTITY_HEADERS.has(norm(header))) continue;
        const metric=metricForHeader(header); if(!metric) continue;
        let value=parseNumber(raw); if(!Number.isFinite(value)) continue;
        if(metric.percent && Math.abs(value)>1.5) value/=100;
        observations.push({personId,role:rep?'representative':'coach',metric,value,date,datasetType:type});
      }
    }
    return observations;
  }

  function topicMatchesMetric(topic,metric){ return Boolean(metric && metric.topic && metric.topic.test(clean(topic))); }
  function outcomeThreshold(metric,before){
    if(metric&&metric.percent) return 0.02;
    return Math.max(1,Math.abs(before||0)*0.03);
  }
  function classifyOutcome(before,after,metric){
    if(!Number.isFinite(before)||!Number.isFinite(after)) return {status:'insufficient',delta:NaN,orientedDelta:NaN};
    const delta=after-before, orientedDelta=delta*(metric&&metric.higher===false?-1:1), threshold=outcomeThreshold(metric,before);
    return {status:orientedDelta>=threshold?'improved':orientedDelta<=-threshold?'declined':'neutral',delta,orientedDelta,threshold};
  }

  function currentScope(){ try{return root.CoachToolsAppData&&root.CoachToolsAppData.getScope?root.CoachToolsAppData.getScope():null;}catch(_){return null;} }
  function personInScope(person,scope,byId){
    if(!scope || !scope.mode || scope.mode==='all') return true;
    if(scope.mode==='representative') return person.personId===scope.personId;
    if(scope.mode==='coach') return person.personId===scope.personId || person.currentCoachId===scope.personId;
    if(scope.mode==='department') return clean(person.department)===clean(scope.department||scope.label);
    if(scope.mode==='team') return clean(person.currentTeam||person.team)===clean(scope.team||scope.label);
    if(scope.mode==='coordinator') return clean(person.coordinator)===clean(scope.coordinator||scope.label);
    if(Array.isArray(scope.coaches)&&scope.coaches.length){
      const coach=person.currentCoachId&&byId.get(person.currentCoachId);
      if(person.role==='coach') return scope.coaches.some(name=>normalizeName(name)===normalizeName(person.displayName));
      return coach && scope.coaches.some(name=>normalizeName(name)===normalizeName(coach.displayName));
    }
    return true;
  }

  async function ready(){
    if(!root.CoachToolsAppData) throw new Error('CoachToolsAppData is unavailable.');
    await root.CoachToolsAppData.ready();
    if(root.CoachToolsIdentity&&root.CoachToolsIdentity.ready) await root.CoachToolsIdentity.ready();
    return true;
  }

  async function loadHistory(type,limit){
    if(!root.CoachToolsData || typeof root.CoachToolsData.getHistory!=='function') return [];
    try{return (await root.CoachToolsData.getHistory(type,{activeOnly:true})).slice(0,limit||13);}catch(_){return [];}
  }

  async function loadContext(options){
    await ready();
    const types=options&&options.types||['weeklyRetail','weeklyReferral','qa','documentedCoaching','checklist'];
    const records=await root.CoachToolsAppData.getMany(types,{includeRecord:true,continueOnError:true,progressUi:false,appId:'coaching-intelligence'});
    const people=root.CoachToolsIdentity&&root.CoachToolsIdentity.getAllPeople?await root.CoachToolsIdentity.getAllPeople():[];
    const resolve=resolverFor(people), histories={};
    if(!options || options.history!==false){
      for(const type of types.filter(type=>/^weekly|^monthly/.test(type))) histories[type]=await loadHistory(type,13);
    }
    const context={records:records||{},histories,people,resolve,scope:currentScope()};
    context.byId=new Map(people.map(person=>[person.personId,person]));
    context.coaching=canonicalizeCoaching(records&&records.documentedCoaching,resolve);
    context.checklist=canonicalizeChecklist(records&&records.checklist,resolve);
    context.qa=canonicalizeQA(records&&records.qa,resolve);
    context.performance=[];
    for(const type of types.filter(type=>/^weekly|^monthly/.test(type))){
      const seen=new Set();
      for(const record of [...(histories[type]||[]),records&&records[type]].filter(Boolean)){
        const id=record.id||record.fingerprint||`${type}:${record.periodSort||record.importedAt||''}`;
        if(seen.has(id)) continue; seen.add(id);
        context.performance.push(...canonicalizePerformance(record,resolve,type));
      }
    }
    return context;
  }

  function metricSeries(context){
    const grouped=new Map();
    for(const row of context.performance||[]){
      if(row.role!=='representative') continue;
      const key=`${row.personId}|${row.metric.id}`;
      if(!grouped.has(key)) grouped.set(key,[]);
      grouped.get(key).push(row);
    }
    for(const rows of grouped.values()) rows.sort((a,b)=>a.date-b.date);
    return grouped;
  }

  function coachingForMetric(context,personId,metric,days){
    const cutoff=Date.now()-(days||60)*DAY;
    return (context.coaching||[]).filter(event=>event.representativeId===personId && event.date.getTime()>=cutoff && event.topics.some(topic=>topicMatchesMetric(topic,metric))).sort((a,b)=>b.date-a.date);
  }

  function buildPerformanceOpportunities(context){
    const series=metricSeries(context), candidates=[], latestByMetric=new Map();
    for(const [key,rows] of series){
      if(!rows.length) continue;
      const [personId,metricId]=key.split('|'), metric=rows[rows.length-1].metric, latest=rows[rows.length-1];
      if(!latestByMetric.has(metricId)) latestByMetric.set(metricId,[]);
      latestByMetric.get(metricId).push({personId,value:latest.value,metric});
    }
    for(const [key,rows] of series){
      if(rows.length<2) continue;
      const [personId]=key.split('|'), person=context.byId.get(personId);
      if(!person || person.role!=='representative' || !personInScope(person,context.scope,context.byId)) continue;
      const metric=rows[rows.length-1].metric, current=rows[rows.length-1].value;
      const recent=rows.slice(-3), prior=rows.slice(Math.max(0,rows.length-6),Math.max(0,rows.length-3));
      const recentAvg=mean(recent.map(row=>row.value)), priorAvg=mean(prior.map(row=>row.value));
      const orientedDelta=Number.isFinite(priorAvg)?(recentAvg-priorAvg)*(metric.higher===false?-1:1):0;
      const cohort=(latestByMetric.get(metric.id)||[]).filter(item=>{
        const peer=context.byId.get(item.personId); return peer&&peer.role==='representative'&&(!person.department||peer.department===person.department);
      });
      const oriented=cohort.map(item=>item.value*(metric.higher===false?-1:1)).sort((a,b)=>a-b), mine=current*(metric.higher===false?-1:1);
      const percentile=oriented.length>=5 ? (oriented.filter(value=>value<mine).length+oriented.filter(value=>value===mine).length*.5)/oriented.length : null;
      const declineThreshold=metric.percent ? .04 : Math.max(1,Math.abs(current)*.04);
      const weak=percentile!=null&&percentile<=.25, declining=Number.isFinite(orientedDelta)&&orientedDelta<=-declineThreshold;
      if(!weak&&!declining) continue;
      const coachings=coachingForMetric(context,personId,metric,75), latestCoaching=coachings[0]||null;
      let status='open';
      if(coachings.length>=2) status='recurred';
      else if(latestCoaching) status='coached-watching';
      const reasons=[];
      if(weak) reasons.push(`Current ${metric.name} is in the lower ${Math.max(1,Math.round((percentile||0)*100))}% of comparable ${person.department||'department'} representatives.`);
      if(declining) reasons.push(`${metric.name} has moved the wrong direction across recent periods.`);
      if(latestCoaching) reasons.push(`Related coaching was documented ${Math.round(daysSince(latestCoaching.date))} days ago.`);
      else reasons.push('No recent matching coaching was found.');
      const severity=Math.round(clamp(45+(weak?(0.25-(percentile||0))/.25*25:0)+(declining?20:0)+(status==='recurred'?10:0),1,100));
      candidates.push({
        id:`perf:${personId}:${metric.id}`,personId,coachId:person.currentCoachId||'',personName:person.displayName,coachName:(context.byId.get(person.currentCoachId)||{}).displayName||'',
        topic:metric.name,metric:metric.name,metricId:metric.id,openedAt:rows[Math.max(0,rows.length-3)].date,status,severity,confidence:rows.length>=6?'strong':rows.length>=3?'moderate':'low',
        recurrenceCount:Math.max(0,coachings.length-1),lastCoachedAt:latestCoaching&&latestCoaching.date||null,
        evidence:{current,recentAverage:recentAvg,previousAverage:priorAvg,percentile:percentile==null?null:Math.round(percentile*100),points:rows.length},attentionReasons:reasons
      });
    }
    return candidates;
  }

  function buildQAOpportunities(context){
    const grouped=new Map();
    for(const row of context.qa||[]){ if(!row.representativeId) continue; if(!grouped.has(row.representativeId)) grouped.set(row.representativeId,[]); grouped.get(row.representativeId).push(row); }
    const latestValues=[];
    for(const [personId,rows] of grouped){ rows.sort((a,b)=>a.date-b.date); latestValues.push({personId,value:mean(rows.slice(-3).map(row=>row.score))}); }
    const result=[];
    for(const [personId,rows] of grouped){
      const person=context.byId.get(personId); if(!person||!personInScope(person,context.scope,context.byId)) continue;
      rows.sort((a,b)=>a.date-b.date); const recent=rows.filter(row=>daysSince(row.date)<=30), prior=rows.filter(row=>daysSince(row.date)>30&&daysSince(row.date)<=60);
      if(!recent.length) continue;
      const current=mean(recent.map(row=>row.score)), previous=mean(prior.map(row=>row.score)), peers=latestValues.filter(item=>{const p=context.byId.get(item.personId);return p&&(!person.department||p.department===person.department);}).map(item=>item.value).filter(Number.isFinite).sort((a,b)=>a-b);
      const percentile=peers.length>=5?(peers.filter(value=>value<current).length+peers.filter(value=>value===current).length*.5)/peers.length:null;
      const declining=Number.isFinite(previous)&&current-previous<=-.04, weak=percentile!=null&&percentile<=.25; if(!declining&&!weak) continue;
      const related=context.coaching.filter(event=>event.representativeId===personId&&daysSince(event.date)<=75&&event.topics.some(topic=>/call.*quality|quality|qa/i.test(topic))).sort((a,b)=>b.date-a.date);
      const status=related.length>=2?'recurred':related.length?'coached-watching':'open', reasons=[];
      if(weak) reasons.push('Recent QA is among the lower department results.'); if(declining) reasons.push('QA has declined compared with the prior 30-day period.');
      reasons.push(related.length?`Related quality coaching was documented ${Math.round(daysSince(related[0].date))} days ago.`:'No recent quality coaching was found.');
      result.push({id:`qa:${personId}`,personId,coachId:person.currentCoachId||'',personName:person.displayName,coachName:(context.byId.get(person.currentCoachId)||{}).displayName||'',topic:'Call Quality',metric:'QA Score',metricId:'qa-score',openedAt:recent[0].date,status,severity:Math.round(clamp(55+(declining?20:0)+(weak?15:0)+(status==='recurred'?10:0),1,100)),confidence:recent.length>=3?'strong':'moderate',recurrenceCount:Math.max(0,related.length-1),lastCoachedAt:related[0]&&related[0].date||null,evidence:{current,recentAverage:current,previousAverage:previous,percentile:percentile==null?null:Math.round(percentile*100),points:recent.length},attentionReasons:reasons});
    }
    return result;
  }

  function supportSummary(context){
    const cutoff=Date.now()-30*DAY, grouped=new Map();
    for(const item of context.checklist||[]){
      if(item.created.getTime()<cutoff) continue;
      const key=item.coachId||normalizeName(item.coach); if(!key) continue;
      if(!grouped.has(key)) grouped.set(key,{coachId:item.coachId||'',coachName:item.coach,items:[]}); grouped.get(key).items.push(item);
    }
    const rows=[];
    for(const group of grouped.values()){
      const coach=context.byId.get(group.coachId); if(coach&&!personInScope(coach,context.scope,context.byId)) continue;
      const completed=group.items.filter(item=>item.served&&Number.isFinite(item.days)), open=group.items.filter(item=>!item.served), oldOpen=open.filter(item=>daysSince(item.created)>3);
      rows.push({coachId:group.coachId,coachName:coach&&coach.displayName||group.coachName,total:group.items.length,served:completed.length,open:open.length,overThreeDays:oldOpen.length,averageDays:mean(completed.map(item=>item.days)),medianDays:median(completed.map(item=>item.days)),oldestOpenDays:open.length?Math.max(...open.map(item=>daysSince(item.created))):0,items:group.items});
    }
    return rows.sort((a,b)=>(b.overThreeDays-a.overThreeDays)||(b.open-a.open)||((b.averageDays||0)-(a.averageDays||0)));
  }

  function buildSupportOpportunities(context){
    const result=[];
    for(const summary of supportSummary(context)){
      if(!(summary.overThreeDays>0 || summary.averageDays>3.25 || summary.open>=5)) continue;
      const reasons=[];
      if(summary.overThreeDays) reasons.push(`${summary.overThreeDays} checklist item${summary.overThreeDays===1?'':'s'} have been waiting more than 3 days.`);
      if(Number.isFinite(summary.averageDays)&&summary.averageDays>3.25) reasons.push(`Average time to serve is ${summary.averageDays.toFixed(1)} days.`);
      if(summary.open) reasons.push(`${summary.open} checklist item${summary.open===1?' is':'s are'} currently open.`);
      result.push({id:`support:${summary.coachId||normalizeName(summary.coachName)}`,personId:summary.coachId,coachId:summary.coachId,personName:summary.coachName,coachName:summary.coachName,topic:'Checklist Support',metric:'Time to Serve',metricId:'checklist-support',openedAt:new Date(Date.now()-summary.oldestOpenDays*DAY),status:'open',severity:Math.round(clamp(45+summary.overThreeDays*8+Math.max(0,(summary.averageDays||0)-3)*8,1,100)),confidence:summary.total>=8?'strong':summary.total>=4?'moderate':'low',recurrenceCount:0,lastCoachedAt:null,evidence:{checklistItems:summary.total,open:summary.open,overThreeDays:summary.overThreeDays,averageDays:summary.averageDays,oldestOpenDays:summary.oldestOpenDays},attentionReasons:reasons});
    }
    return result;
  }

  function buildOpportunities(context){
    return [...buildPerformanceOpportunities(context),...buildQAOpportunities(context),...buildSupportOpportunities(context)].sort((a,b)=>b.severity-a.severity||String(a.personName).localeCompare(String(b.personName)));
  }

  function performanceOutcomes(context){
    const series=metricSeries(context), outcomes=[];
    for(const event of context.coaching||[]){
      if(!event.representativeId) continue;
      for(const topic of event.topics){
        const metric=METRICS.find(candidate=>topicMatchesMetric(topic,candidate)); if(!metric) continue;
        const rows=series.get(`${event.representativeId}|${metric.id}`)||[];
        const beforeRows=rows.filter(row=>row.date<event.date).slice(-3), afterRows=rows.filter(row=>row.date>event.date).slice(0,3);
        if(!beforeRows.length||!afterRows.length) continue;
        const before=mean(beforeRows.map(row=>row.value)), after=mean(afterRows.map(row=>row.value)), classification=classifyOutcome(before,after,metric), person=context.byId.get(event.representativeId), coach=context.byId.get(event.coachId);
        outcomes.push({kind:'performance',personId:event.representativeId,personName:person&&person.displayName||event.representative,coachId:event.coachId,coachName:coach&&coach.displayName||event.coach,topic,metric:metric.name,metricId:metric.id,date:event.date,before,after,...classification});
      }
    }
    return outcomes;
  }

  function qaOutcomes(context){
    const byRep=new Map(); for(const row of context.qa||[]){if(!row.representativeId)continue;if(!byRep.has(row.representativeId))byRep.set(row.representativeId,[]);byRep.get(row.representativeId).push(row);} for(const rows of byRep.values()) rows.sort((a,b)=>a.date-b.date);
    const metric={id:'qa-score',name:'QA Score',higher:true,percent:true}, outcomes=[];
    for(const event of context.coaching||[]){
      if(!event.representativeId || !event.topics.some(topic=>/call.*quality|quality|qa/i.test(topic))) continue;
      const rows=byRep.get(event.representativeId)||[], beforeRows=rows.filter(row=>row.date<event.date).slice(-3), afterRows=rows.filter(row=>row.date>event.date).slice(0,3);
      if(!beforeRows.length||!afterRows.length) continue;
      const before=mean(beforeRows.map(row=>row.score)),after=mean(afterRows.map(row=>row.score)),classification=classifyOutcome(before,after,metric),person=context.byId.get(event.representativeId),coach=context.byId.get(event.coachId);
      outcomes.push({kind:'qa',personId:event.representativeId,personName:person&&person.displayName||event.representative,coachId:event.coachId,coachName:coach&&coach.displayName||event.coach,topic:event.topics.find(topic=>/call.*quality|quality|qa/i.test(topic))||'Call Quality',metric:'QA Score',metricId:'qa-score',date:event.date,before,after,...classification});
    }
    return outcomes;
  }

  function summarizeOutcomes(outcomes){
    const valid=(outcomes||[]).filter(row=>row.status!=='insufficient');
    return {total:valid.length,improved:valid.filter(row=>row.status==='improved').length,neutral:valid.filter(row=>row.status==='neutral').length,declined:valid.filter(row=>row.status==='declined').length,averageChange:mean(valid.map(row=>row.orientedDelta)),rows:valid};
  }
  function coachEffectiveness(outcomes){
    const grouped=new Map();
    for(const row of outcomes||[]){ const key=`${row.coachId||normalizeName(row.coachName)}|${row.topic}`; if(!grouped.has(key)) grouped.set(key,{coachId:row.coachId,coachName:row.coachName,topic:row.topic,rows:[]}); grouped.get(key).rows.push(row); }
    return Array.from(grouped.values()).map(group=>{const summary=summarizeOutcomes(group.rows);return {...group,total:summary.total,improved:summary.improved,declined:summary.declined,averageChange:summary.averageChange,successRate:summary.total?summary.improved/summary.total:NaN};}).filter(row=>row.total>=2).sort((a,b)=>(b.successRate||0)-(a.successRate||0)||b.total-a.total);
  }

  function buildRecognition(context){
    const series=metricSeries(context), result=[];
    for(const [key,rows] of series){
      if(rows.length<4) continue; const [personId]=key.split('|'),person=context.byId.get(personId); if(!person||!personInScope(person,context.scope,context.byId)) continue;
      const metric=rows[rows.length-1].metric,recent=mean(rows.slice(-2).map(row=>row.value)),prior=mean(rows.slice(-4,-2).map(row=>row.value)); if(!Number.isFinite(recent)||!Number.isFinite(prior))continue;
      const oriented=(recent-prior)*(metric.higher===false?-1:1), threshold=metric.percent ? .04 : Math.max(1,Math.abs(prior)*.04); if(oriented<threshold)continue;
      result.push({personId,personName:person.displayName,coachId:person.currentCoachId||'',coachName:(context.byId.get(person.currentCoachId)||{}).displayName||'',topic:metric.name,metric:metric.name,metricId:metric.id,change:recent-prior,orientedChange:oriented,current:recent,message:`${metric.name} has improved across recent periods.`});
    }
    return result.sort((a,b)=>b.orientedChange-a.orientedChange).slice(0,30);
  }

  function personStory(context,personId,precomputed){
    const person=context.byId.get(personId); if(!person)return '';
    const all=precomputed||buildSummary(context), opportunities=all.opportunities.filter(row=>row.personId===personId), recognition=all.recognition.filter(row=>row.personId===personId), outcomes=[...all.performanceOutcomes.rows,...all.qaOutcomes.rows].filter(row=>row.personId===personId).sort((a,b)=>b.date-a.date), checklist=context.checklist.filter(item=>item.representativeId===personId&&daysSince(item.created)<=30);
    const sentences=[];
    if(opportunities.length){ const top=opportunities[0]; sentences.push(`${person.displayName}'s clearest current attention area is ${top.topic}. ${top.attentionReasons[0]||''}`.trim()); if(top.status==='recurred')sentences.push('The issue appears to have returned after repeated related coaching.'); else if(top.status==='coached-watching')sentences.push('Related coaching is already documented, so this is best treated as a follow-up rather than a brand-new coaching need.'); }
    else if(recognition.length){ const top=recognition[0]; sentences.push(`${person.displayName} is showing positive momentum in ${top.topic}.`); }
    if(outcomes.length){ const latest=outcomes[0]; if(latest.status==='improved')sentences.push(`The most recent measurable ${latest.topic} coaching outcome is positive.`); else if(latest.status==='declined')sentences.push(`The most recent measurable ${latest.topic} coaching outcome did not produce sustained improvement.`); }
    if(checklist.length) sentences.push(`${checklist.length} checklist item${checklist.length===1?'':'s'} were recorded for this representative in the last 30 days.`);
    if(!sentences.length) sentences.push(`No high-confidence coaching intelligence is currently standing out for ${person.displayName}.`);
    return sentences.join(' ');
  }

  function buildSummary(context){
    const opportunities=buildOpportunities(context), performance=summarizeOutcomes(performanceOutcomes(context)), qa=summarizeOutcomes(qaOutcomes(context)), support=supportSummary(context), recognition=buildRecognition(context);
    const followUp=opportunities.filter(row=>row.status==='coached-watching'||row.status==='recurred');
    return {context,opportunities,needCoaching:opportunities.filter(row=>row.status==='open'&&row.metricId!=='checklist-support'),followUp,supportDelays:opportunities.filter(row=>row.metricId==='checklist-support'),recognition,performanceOutcomes:performance,qaOutcomes:qa,coachEffectiveness:coachEffectiveness([...performance.rows,...qa.rows]),support};
  }

  function cacheKey(kind){
    const versions=['weeklyRetail','weeklyReferral','qa','documentedCoaching','checklist'].map(type=>{try{const v=root.CoachToolsAppData&&root.CoachToolsAppData.getVersion?root.CoachToolsAppData.getVersion(type):null;return `${type}:${v&&v.version||0}:${v&&v.fingerprint||''}`;}catch(_){return `${type}:0`;}}).join('|');
    const scope=currentScope()||{}; return `${kind}|${versions}|${scope.mode||'all'}:${scope.personId||scope.label||''}`;
  }
  async function commandCenter(options){
    const key=cacheKey('command'),existing=cache.get(key); if(existing&&Date.now()-existing.at<CACHE_MS)return existing.value;
    const context=await loadContext({types:['weeklyRetail','weeklyReferral','qa','documentedCoaching','checklist'],history:true,...(options||{})}), value=buildSummary(context); cache.clear(); cache.set(key,{at:Date.now(),value}); return value;
  }

  async function insightForApp(appId,options){
    const summary=await commandCenter(), personId=options&&options.personId;
    if(appId==='people-profiles'&&personId){
      const relevant=summary.opportunities.filter(row=>row.personId===personId), positive=summary.recognition.filter(row=>row.personId===personId), story=personStory(summary.context,personId,summary);
      if(!relevant.length&&!positive.length)return null;
      const top=relevant[0]; return {tone:top?'attention':'positive',title:top?`${top.topic} needs attention`:`Positive momentum`,summary:top?(top.attentionReasons[0]||'A coaching follow-up is worth reviewing.'):(positive[0]&&positive[0].message)||'Positive movement detected.',detailTitle:'Coaching Intelligence',story,items:relevant.slice(0,5)};
    }
    if(appId==='coaching-gaps'){
      const actionable=summary.opportunities.filter(row=>row.metricId!=='checklist-support'); if(!actionable.length)return null; const recurred=actionable.filter(row=>row.status==='recurred').length;
      return {tone:recurred?'attention':'watch',title:`${actionable.length} coaching opportunit${actionable.length===1?'y':'ies'}`,summary:recurred?`${recurred} appear to have recurred after prior coaching.`:'Open and follow-up coaching needs are available.',detailTitle:'Opportunity Lifecycle',items:actionable.slice(0,12)};
    }
    if(appId==='kpi-impact'){
      const out=summary.performanceOutcomes; if(out.total<2)return null; return {tone:out.declined>out.improved?'watch':'info',title:`${out.total} measurable coaching outcomes`,summary:`${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`,detailTitle:'Coaching Outcomes',outcomes:out.rows.slice().sort((a,b)=>b.date-a.date).slice(0,15),coachEffectiveness:summary.coachEffectiveness.filter(row=>row.rows.some(item=>item.kind==='performance')).slice(0,10)};
    }
    if(appId==='qa-scores'){
      const out=summary.qaOutcomes; if(out.total<2)return null; return {tone:out.declined>out.improved?'watch':'info',title:`${out.total} measurable QA coaching outcomes`,summary:`${out.improved} improved · ${out.neutral} neutral · ${out.declined} declined`,detailTitle:'QA Coaching Outcomes',outcomes:out.rows.slice().sort((a,b)=>b.date-a.date).slice(0,15),coachEffectiveness:summary.coachEffectiveness.filter(row=>row.rows.some(item=>item.kind==='qa')).slice(0,10)};
    }
    if(appId==='coach-timeline'){
      const delayed=summary.supportDelays, support=summary.support; if(!support.length)return null; const total=support.reduce((sum,row)=>sum+row.total,0), avg=mean(support.map(row=>row.averageDays).filter(Number.isFinite)), over=support.reduce((sum,row)=>sum+row.overThreeDays,0);
      return {tone:delayed.length?'attention':'info',title:`Checklist support · ${total} items`,summary:`Avg time to serve ${formatDays(avg)} · ${over} waiting > 3 days`,detailTitle:'Checklist Support Load',support:support.slice(0,15)};
    }
    return null;
  }

  function invalidate(){ cache.clear(); }
  try{root.addEventListener('coachtools:data-updated',invalidate);root.addEventListener('coachtools:scope-updated',invalidate);}catch(_){}

  root.CoachToolsIntelligence=Object.freeze({
    VERSION,METRICS,ready,loadContext,commandCenter,insightForApp,personStory,buildSummary,buildOpportunities,supportSummary,performanceOutcomes,qaOutcomes,coachEffectiveness,invalidate,
    formatPercent,formatDays,
    _test:Object.freeze({clean,norm,parseNumber,parseDate,extractRows,canonicalizeCoaching,canonicalizeChecklist,canonicalizeQA,canonicalizePerformance,classifyOutcome,personInScope,mean,median})
  });
})(typeof window!=='undefined'?window:globalThis);
