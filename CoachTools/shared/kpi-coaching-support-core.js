(function(root, factory){
  'use strict';
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.KpiCoachingSupportCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  const CATEGORIES = Object.freeze({
    'needs-support':'Needs support',
    stagnant:'Supported but stagnant',
    growing:'Supported but growing',
    'follow-up':'Awaiting follow-up',
    'on-track':'On track',
    insufficient:'Not enough KPI data'
  });
  const pad = value => String(value).padStart(2, '0');
  const ymd = date => date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate());
  const normalized = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  function personKey(value){
    let name = normalized(value).replace(/\./g, '');
    if(name.includes(',')){
      const [last, ...first] = name.split(',');
      name = first.join(' ').trim() + ' ' + last.trim();
    }
    const words = name.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    return words.length > 1 ? words[0] + ' ' + words[words.length-1] : words[0] || '';
  }
  function dateValue(value){
    if(value == null || value === '') return null;
    let result;
    if(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)){
      const [year, month, day] = value.split('-').map(Number);
      result = new Date(0); result.setFullYear(year, month-1, day); result.setHours(12,0,0,0);
      if(result.getFullYear() !== year || result.getMonth() !== month-1 || result.getDate() !== day) return null;
    }else{
      result = new Date(value);
      if(!Number.isFinite(result.getTime())) return null;
      result.setHours(12,0,0,0);
    }
    return Number.isFinite(result.getTime()) ? result : null;
  }
  function sunday(date){const result = new Date(date); result.setDate(result.getDate()-result.getDay());return result;}
  function addDays(date, count){const result = new Date(date);result.setDate(result.getDate()+count);return result;}
  function weekLabel(start){
    const end = addDays(start,6), months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[start.getMonth()]+' '+start.getDate()+'–'+(start.getMonth() === end.getMonth() ? '' : months[end.getMonth()]+' ')+end.getDate();
  }
  const number = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  function weighted(points){
    const measured = points.filter(point=>Number.isFinite(point.rate) && point.opps>0);
    const opportunities = measured.reduce((sum,point)=>sum+point.opps,0);
    return opportunities>0 ? measured.reduce((sum,point)=>sum+point.apps,0)/opportunities : null;
  }
  const typesFor = event => Array.isArray(event?.types) ? event.types.map(String).map(value=>value.trim()).filter(Boolean) : [];
  const hasType = (event, type) => !type || typesFor(event).some(value=>normalized(value)===normalized(type));
  const topicsFor = event => Array.isArray(event?.topics) && event.topics.length ? event.topics.map(String).map(value=>value.trim()).filter(Boolean) : typesFor(event);
  const matchesTopic = (event, topic) => !topic || topicsFor(event).some(value=>normalized(value)===normalized(topic));
  const matchesCoachingType = (event, type) => !type || normalized(event.coachingType)===normalized(type) || (Array.isArray(event.supportTypes) && event.supportTypes.some(value=>normalized(value)===normalized(type)));
  const signedPp = value => (value>=0 ? '+' : '')+(value*100).toFixed(1)+' pp';
  function analyze(options = {}){
    const inputRows = Array.isArray(options.rows) ? options.rows : [];
    const inputEvents = Array.isArray(options.coachings) ? options.coachings : [];
    const inputCorrectives = Array.isArray(options.correctives) ? options.correctives : [];
    const goalValue = number(options.goal), goal = Number.isFinite(goalValue) && goalValue>=0 && goalValue<=1 ? goalValue : null;
    const thresholdValue = number(options.growthThresholdPp);
    const growthThresholdPp = Number.isFinite(thresholdValue) && thresholdValue>=0 ? thresholdValue : 1;
    const threshold = growthThresholdPp/100;
    const topic = String(options.topic || '').trim() || null, correctiveType = String(options.correctiveType || '').trim() || null;
    const coachingType = String(options.coachingType || '').trim() || null;
    const correctiveIncident = String(options.correctiveIncident || '').trim() || null;
    const groups = new Map(), periods = new Map();
    for(const row of inputRows){
      const rep = String(row?.rep ?? '').trim(), key = personKey(rep), date = dateValue(row?.date);
      if(!key || !date) continue;
      const start = sunday(date), week = ymd(start);
      periods.set(week,start);
      const group = groups.get(key) || {rep,weekly:new Map()};
      const aggregate = group.weekly.get(week) || {date:week,label:weekLabel(start),apps:0,opps:0,validRows:0};
      const apps = number(row.apps), opps = number(row.opps);
      // Missing or invalid counts are absent evidence, never a zero-rate week.
      if(Number.isFinite(apps) && Number.isFinite(opps) && apps>=0 && opps>=0){
        aggregate.apps += apps;aggregate.opps += opps;aggregate.validRows++;
      }
      group.weekly.set(week,aggregate);groups.set(key,group);
    }
    const weeks = [...periods.keys()].sort(), windowStart = weeks[0] || null;
    const asOf = weeks.length ? ymd(addDays(periods.get(weeks[weeks.length-1]),6)) : null;
    const eventsByRep = new Map(), topics = new Set(), coachingTypes = new Set();
    for(const input of inputEvents){
      const key = personKey(input?.rep), date = dateValue(input?.date);
      if(!groups.has(key) || !date || !windowStart || !asOf) continue;
      const day = ymd(date);
      if(day<windowStart || day>asOf) continue;
      const types = typesFor(input), eventTopics=topicsFor(input);eventTopics.forEach(type=>topics.add(type));
      const eventCoachingType=String(input.coachingType ?? '').trim();if(eventCoachingType)coachingTypes.add(eventCoachingType);
      const event = {rep:String(input.rep ?? '').trim(),date:day,types,topics:eventTopics,coachingType:eventCoachingType,supportTypes:Array.isArray(input.supportTypes) ? input.supportTypes.map(String) : [],desc:String(input.desc ?? ''),coach:String(input.coach ?? ''),topicMatch:matchesTopic(input,topic),source:'documented',completion:'Recorded',actionStatus:'',incident:String(input.incident ?? ''),correctiveType:correctiveType && hasType(input,correctiveType) ? correctiveType : null};
      const list = eventsByRep.get(key) || [];
      list.push(event);eventsByRep.set(key,list);
    }
    for(const events of eventsByRep.values())events.sort((a,b)=>b.date.localeCompare(a.date));
    const checklistByRep = new Map();
    if(correctiveType && windowStart && asOf){
      for(const input of inputCorrectives){
        const key=personKey(input?.rep), type=String(input?.correctiveType ?? '').trim(), incident=String(input?.incident ?? '').trim();
        if(!groups.has(key) || normalized(type)!==normalized(correctiveType) || (correctiveIncident && normalized(incident)!==normalized(correctiveIncident)))continue;
        const created=dateValue(input.createdDate || input.date), served=dateValue(input.servedDate);
        const createdDay=created ? ymd(created) : null, servedDay=served ? ymd(served) : null;
        if(createdDay && createdDay>asOf)continue;
        const completed=!!servedDay && servedDay<=asOf;
        const day=completed ? servedDay : createdDay;
        if(!day || day<windowStart || day>asOf)continue;
        const event={rep:String(input.rep ?? '').trim(),date:day,createdDate:createdDay,servedDate:servedDay,
          types:[type],correctiveType:type,incident,desc:String(input.desc ?? ''),coach:String(input.coach ?? ''),
          actionStatus:String(input.status ?? ''),completion:completed ? 'Served' : 'Open',source:'checklist',topicMatch:null};
        const events=checklistByRep.get(key) || [];events.push(event);checklistByRep.set(key,events);
      }
    }
    const counts = Object.fromEntries(Object.keys(CATEGORIES).map(category=>[category,0]));
    const people = [];
    for(const [key,group] of groups){
      const series = [...group.weekly.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(point=>({
        date:point.date,label:point.label,apps:point.validRows ? point.apps : null,opps:point.validRows ? point.opps : null,
        rate:point.validRows && point.opps>0 ? point.apps/point.opps : null
      }));
      const measured = series.filter(point=>Number.isFinite(point.rate));
      const latest = measured[measured.length-1] || null, currentRate = latest?.rate ?? null;
      const split = Math.floor(measured.length/2), older = measured.slice(0,split), newer = measured.slice(split);
      const trendBeforeRate = weighted(older), trendAfterRate = weighted(newer);
      const trendDelta = measured.length>=2 ? trendAfterRate-trendBeforeRate : null;
      const growing = value => Number.isFinite(value) && value>0 && value+1e-12>=threshold;
      const declining = value => Number.isFinite(value) && value<0 && -value+1e-12>=threshold;
      const trendLabel = trendDelta===null ? 'Not enough data' : growing(trendDelta) ? 'Growing' : declining(trendDelta) ? 'Declining' : 'Stagnant';
      const needGap = goal!==null && currentRate!==null ? Math.max(0,goal-currentRate) : null;
      const needLevel = needGap===null ? 'unknown' : needGap<=1e-12 ? 'at-goal' : needGap+1e-12>=.1 ? 'high' : needGap+1e-12>=.05 ? 'moderate' : 'low';
      const allEvents = eventsByRep.get(key) || [], topicEvents = allEvents.filter(event=>event.topicMatch);
      const documentedCorrectiveEvents = correctiveType ? allEvents.filter(event=>hasType(event,correctiveType) && (!correctiveIncident || normalized(event.incident)===normalized(correctiveIncident))) : [];
      const checklistCorrectiveEvents = checklistByRep.get(key) || [];
      const correctiveEvents = [...documentedCorrectiveEvents,...checklistCorrectiveEvents].sort((a,b)=>b.date.localeCompare(a.date));
      const coachingEvents = topicEvents.filter(event=>matchesCoachingType(event,coachingType) && (!correctiveType || !hasType(event,correctiveType)));
      const latestCoaching = coachingEvents[0] || null;
      const latestCorrective = correctiveEvents[0] || null;
      const correctiveAfterSupport = !!latestCoaching && correctiveEvents.some(event=>(event.source==='checklist' || event.topicMatch) && event.date>=latestCoaching.date);
      const coachingWeek = latestCoaching ? ymd(sunday(dateValue(latestCoaching.date))) : null;
      const before = coachingWeek ? measured.filter(point=>point.date<coachingWeek) : [];
      const after = coachingWeek ? measured.filter(point=>point.date>coachingWeek) : [];
      const preRate = weighted(before), postRate = weighted(after);
      const responseDelta = preRate!==null && postRate!==null ? postRate-preRate : null;
      const responseSample = {beforeWeeks:before.length,afterWeeks:after.length};
      const belowGoalWeeks = goal===null ? 0 : measured.filter(point=>point.rate+1e-12<goal).length;
      let category;
      if(!latest) category='insufficient';
      else if(latestCoaching) category=responseDelta===null ? 'follow-up' : growing(responseDelta) ? 'growing' : needGap!==null && needGap<=1e-12 ? 'on-track' : 'stagnant';
      else category=needGap!==null && needGap<=1e-12 ? 'on-track' : 'needs-support';
      const reasons=[];
      if(currentRate===null)reasons.push('No measurable KPI week in this window.');
      else if(needGap===null)reasons.push('Set a KPI goal to measure the performance gap.');
      else if(needGap>1e-12)reasons.push((needGap*100).toFixed(1)+' pp below goal in the latest measured week.');
      else reasons.push('At or above goal in the latest measured week.');
      if(measured.length>=2)reasons.push('Window trend '+signedPp(trendDelta)+'; weighted earlier weeks compared with later weeks.');
      if(belowGoalWeeks>0)reasons.push('Below goal in '+belowGoalWeeks+' of '+measured.length+' measured weeks.');
      let categoryReason;
      if(category==='insufficient') categoryReason='KPI counts are missing or have no opportunities. Coaching activity alone cannot establish performance.';
      else if(!latestCoaching)categoryReason='No matching non-corrective coaching found in this data window.';
      else if(responseDelta===null)categoryReason='Matching coaching is recorded, but a measured week before and after its week is needed to assess the response.';
      else categoryReason=(category==='on-track' ? 'At or above goal; maintaining performance after coaching. ' : '')+'Since the latest matching coaching: '+signedPp(responseDelta)+' ('+before.length+' before-week'+(before.length===1?'':'s')+', '+after.length+' after-week'+(after.length===1?'':'s')+'). The coaching week is excluded.';
      reasons.push(categoryReason);
      if(correctiveAfterSupport)reasons.push('Selected corrective type is recorded on or after the latest support. Checklist incidents are a separate selection from coaching topics.');
      counts[category]++;
      people.push({
        rep:group.rep,currentRate,currentDate:latest?.date || null,latestWeekLabel:latest?.label || null,windowRate:weighted(measured),series,
        trendDelta,trendLabel,trendBeforeRate,trendAfterRate,needGap,needLevel,belowGoalWeeks,totalMeasuredWeeks:measured.length,
        topicEvents,coachingEvents,latestCoaching,coachingCount:coachingEvents.length,correctiveEvents,latestCorrective,documentedCorrectiveEvents,checklistCorrectiveEvents,
        correctiveOpenCount:checklistCorrectiveEvents.filter(event=>event.completion==='Open').length,
        correctiveServedCount:checklistCorrectiveEvents.filter(event=>event.completion==='Served').length,
        latestCorrectiveTopicMatch:latestCorrective?.topicMatch || false,correctiveAfterSupport,
        preRate,postRate,responseDelta,responseSample,category,categoryLabel:CATEGORIES[category],categoryReason,reasons
      });
    }
    people.sort((a,b)=>(b.needGap ?? -1)-(a.needGap ?? -1) || a.rep.localeCompare(b.rep));
    return {people,counts,asOf,windowStart,goal,topic,coachingType,correctiveType,correctiveIncident,topics:[...topics].sort((a,b)=>a.localeCompare(b)),coachingTypes:[...coachingTypes].sort((a,b)=>a.localeCompare(b)),growthThresholdPp};
  }
  return Object.freeze({analyze});
});
