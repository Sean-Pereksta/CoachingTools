/* Reusable Qualtrics prioritization and display-format logic. */
'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.QualtricsInsights=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  const DISPLAY_FORMATS=new Set(['auto','percentage','number','count','currency','duration']);
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,Number(value)||0));
  const normalizedHeader=value=>String(value??'').toLowerCase().replace(/[^a-z0-9%]+/g,' ');
  const precision=value=>Math.max(0,Math.min(4,Math.round(Number(value)||0)));
  function normalizeFormatConfig(raw,defaultPrecision=1){
    raw=raw||{};
    const format=DISPLAY_FORMATS.has(String(raw.format||'').toLowerCase())?String(raw.format).toLowerCase():'auto';
    const supplied=raw.precision!==''&&raw.precision!=null&&Number.isFinite(Number(raw.precision));
    return {format,precision:precision(supplied?raw.precision:defaultPrecision)};
  }
  function numericValue(value){
    if(typeof value==='number') return Number.isFinite(value)?value:NaN;
    const raw=String(value??'').trim();
    if(!raw) return NaN;
    const negative=/^\s*\(.*\)\s*$/.test(raw);
    const cleaned=raw.replace(/[,$%()\s]/g,'').replace(/[^0-9.eE+\-]/g,'');
    if(!cleaned||cleaned==='-'||cleaned==='.'||cleaned==='+') return NaN;
    const parsed=Number(cleaned);
    return Number.isFinite(parsed)?(negative?-Math.abs(parsed):parsed):NaN;
  }
  function percentHeader(header){
    const raw=String(header??''), key=normalizedHeader(raw).replace(/\s+/g,'');
    return raw.includes('%')||/(^|\b)(pct|percent|percentage|rate|ratio|scheduled|scheduling|usage|conversion|convert|attach|penetration|adoption|utilization|accuracy|quality)(\b|$)/i.test(normalizedHeader(raw))||/(savethesale|cashscheduled|appointmentrate|close(?:d)?rate|successrate|conversionrate|attachrate)/.test(key);
  }
  function detectAutoFormat(header,value){
    const h=normalizedHeader(header);
    if(percentHeader(header)||/%/.test(String(value??''))) return 'percentage';
    if(/\b(duration|aht|handle time|talk time|hold time|seconds?|minutes?|hours?)\b/.test(h)) return 'duration';
    if(/\b(currency|revenue|amount|cost|price|dollars?|sales value)\b/.test(h)||/^\s*\$/.test(String(value??''))) return 'currency';
    if(/\b(count|volume|calls?|records?|occurrences?|units?)\b/.test(h)) return 'count';
    return 'raw';
  }
  function percentageValue(value){
    let n=numericValue(value);
    if(!Number.isFinite(n)) return NaN;
    if(/%/.test(String(value??''))||Math.abs(n)>1.5) n/=100;
    return n;
  }
  function formatDuration(value){
    const raw=String(value??'').trim();
    if(!raw) return '';
    if(/^\d{1,3}:\d{2}(?::\d{2})?$/.test(raw)) return raw;
    let seconds=numericValue(value);
    if(!Number.isFinite(seconds)) return raw;
    seconds=Math.max(0,Math.round(seconds));
    const hours=Math.floor(seconds/3600), minutes=Math.floor((seconds%3600)/60), remaining=seconds%60;
    return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(remaining).padStart(2,'0')}`:`${minutes}:${String(remaining).padStart(2,'0')}`;
  }
  function formatDisplayValue(header,value,rawConfig){
    const raw=String(value??'').trim();
    if(!raw) return '';
    const config=normalizeFormatConfig(rawConfig,1), format=config.format==='auto'?detectAutoFormat(header,value):config.format;
    if(format==='raw') return raw;
    if(format==='duration') return formatDuration(value);
    if(format==='percentage'){
      const n=percentageValue(value);
      return Number.isFinite(n)?`${(n*100).toFixed(config.precision)}%`:raw;
    }
    const n=numericValue(value);
    if(!Number.isFinite(n)) return raw;
    if(format==='count') return Math.round(n).toLocaleString('en-US');
    if(format==='currency') return n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:config.precision,maximumFractionDigits:config.precision});
    return n.toLocaleString('en-US',{minimumFractionDigits:config.precision,maximumFractionDigits:config.precision});
  }
  function formatDisplayText(header,value,rawConfig){
    const formatted=formatDisplayValue(header,value,rawConfig);
    if(!formatted) return '';
    const template=String(rawConfig?.template||'').trim();
    if(!template) return formatted;
    return /\{value\}/i.test(template)?template.replace(/\{value\}/gi,formatted):`${formatted} ${template}`;
  }
  function classifyCorrective(raw){
    const input=raw||{}, historyCount=Math.max(0,Number(input.historyCount)||0), recentCount=Math.max(0,Number(input.recentCount)||0);
    const currentPoor=!!input.currentPoor, severity=clamp(input.severity), persistent=!!input.persistent, worsening=!!input.worsening, improving=!!input.improving, repeatNeed=!!input.repeatNeed, hasRecentCoaching=!!input.hasRecentCoaching;
    if(!historyCount) return {level:'none',state:improving?'improving':(currentPoor?'standard':'plain'),tags:improving?['Improving']:(persistent?['Persistent']:[]),scoreBoost:improving?-8:0};
    if(!currentPoor) return {level:'context',state:improving?'improving':'plain',tags:improving?['Prior Corrective — Improving']:[],scoreBoost:improving?-8:0};
    if(improving&&severity<.75) return {level:'context',state:'improving',tags:['Prior Corrective — Improving'],scoreBoost:-8};
    const critical=(recentCount>0&&(severity>=.62||persistent||worsening))||(historyCount>1&&severity>=.82)||(persistent&&severity>=.78);
    if(critical){
      const tags=[historyCount>1?'Repeat Corrective History + Current Need':recentCount>0?'Recent Corrective + Current Need':'Corrective History + Current Need'];
      if(persistent) tags.push(hasRecentCoaching?'Coaching Not Sticking':'Persistent');
      else if(worsening) tags.push('Worsening');
      return {level:'critical',state:'critical',tags:tags.slice(0,2),scoreBoost:15};
    }
    const tags=[recentCount>0?'Recent Corrective + Current Need':'Corrective History + Current Need'];
    if(worsening) tags.push('Worsening');
    else if(repeatNeed||persistent) tags.push('Repeat Need');
    else if(!hasRecentCoaching) tags.push('No Recent Coaching');
    return {level:'elevated',state:'elevated',tags:tags.slice(0,2),scoreBoost:8};
  }
  function scoreOpportunity(raw){
    const input=raw||{}, severity=clamp(input.severity), breadth=clamp(input.breadth), recurring=clamp(input.recurring), uncoached=Number.isFinite(Number(input.uncoached))?clamp(input.uncoached):NaN, trendSeverity=Number.isFinite(Number(input.trendSeverity))?clamp(input.trendSeverity):NaN, corrective=clamp(input.corrective);
    const context=[];
    if(recurring) context.push([recurring,.25]);
    if(Number.isFinite(uncoached)) context.push([uncoached,.30]);
    if(Number.isFinite(trendSeverity)) context.push([trendSeverity,.25]);
    if(corrective) context.push([corrective,.20]);
    const contextWeight=context.reduce((sum,item)=>sum+item[1],0), contextValue=contextWeight?context.reduce((sum,item)=>sum+item[0]*item[1],0)/contextWeight:0;
    let base=(severity*.72)+(breadth*.18)+(contextValue*(contextWeight ? .10 : 0));
    if(severity>=.72) base=Math.max(base,.60+(severity*.30));
    const factor=Math.max(0,Number(input.weightFactor)||1), score=Math.round(clamp(base*factor)*100);
    return {score,base:base*100,severity,breadth,context:contextValue,pattern:opportunityPattern(severity,breadth,input.affected)};
  }
  function opportunityPattern(severity,breadth,affected){
    const severityLabel=clamp(severity)>=.68?'High':clamp(severity)>=.4?'Moderate':'Low';
    const broad=clamp(breadth)>=.45&&Number(affected||0)>2;
    return {severity:severityLabel,breadth:broad?'Broad':'Concentrated',label:`${severityLabel} / ${broad?'Broad':'Concentrated'}`};
  }
  function concentration(raw){
    const input=raw||{}, orgs=Math.max(0,Number(input.affectedOrganizations)||0), totalOrgs=Math.max(0,Number(input.totalOrganizations)||0), teams=Math.max(0,Number(input.affectedTeams)||0), totalTeams=Math.max(0,Number(input.totalTeams)||0), people=Math.max(0,Number(input.affectedPeople)||0), totalPeople=Math.max(0,Number(input.totalPeople)||0);
    const orgShare=totalOrgs?orgs/totalOrgs:0, teamShare=totalTeams?teams/totalTeams:0, peopleShare=totalPeople?people/totalPeople:0;
    if(totalOrgs>1&&orgShare>=.65) return {key:'organizationWide',label:'Organization-wide',detail:`${orgs}/${totalOrgs} orgs`};
    if(orgs===1&&totalOrgs>1) return {key:'orgSpecific',label:'Org-specific',detail:'concentrated in one organization'};
    if(teams>0&&(teams<=3||teamShare<.35)&&people>2) return {key:'teamSpecific',label:'Team-specific',detail:`${teams} team${teams===1?'':'s'} driving opportunity`};
    return {key:'individual',label:'Individual / scattered',detail:people?`${people} affected representative${people===1?'':'s'}`:'limited affected population',peopleShare};
  }
  function evidenceConfidence(raw){
    const input=raw||{}, people=Math.max(0,Number(input.people)||0), observations=Math.max(0,Number(input.observations)||0), weeks=Math.max(0,Number(input.weeks)||0);
    const score=(Math.min(people,12)/12*.45)+(Math.min(observations,36)/36*.35)+(Math.min(weeks,18)/18*.20);
    return score>=.72?'Strong evidence':score>=.38?'Moderate evidence':'Limited sample';
  }
  function trendLabel(raw){
    const input=raw||{}, observations=Math.max(0,Number(input.observations)||0), improving=clamp(input.improving), worsening=clamp(input.worsening);
    if(observations<3) return 'Insufficient history';
    if(improving-worsening>=.2) return 'Improving';
    if(worsening-improving>=.2) return 'Declining';
    return 'Stable';
  }
  function normalizeConcernIdentity(value){ return String(value??'').trim().toLowerCase().replace(/\s+/g,' '); }
  function concernReportIdentity(row){
    row=row||{};
    const stable=row.ruleId??row.RuleID??row['Rule ID']??row.reportId??row.ReportID??row['Report ID'];
    if(String(stable??'').trim()) return `id:${normalizeConcernIdentity(stable)}`;
    const label=row.ruleTitle??row.Rule??row['Rule Name']??row.reportName??row.Report??row.Concern??row.Category??row.Topic;
    const normalized=normalizeConcernIdentity(label);
    return normalized?`name:${normalized}`:'';
  }
  function concernRepReportKey(row){
    row=row||{};
    const rep=normalizeConcernIdentity(row.repKey||row.RepKey)||normalizeConcernName(row.repName??row.Representative??row['Representative Name']??row['Agent Name']??row['Associate Name']??row.Rep??row.Name);
    const report=concernReportIdentity(row);
    return rep&&report?`${rep}\u001f${report}`:'';
  }
  function summarizeConcernReportCounts(rows){
    const counts=new Map(), labels=new Map(); let ambiguous=0,total=0;
    for(const row of rows||[]){
      const key=concernRepReportKey(row); if(!key){ ambiguous++; continue; }
      counts.set(key,(counts.get(key)||0)+1); total++;
      if(!labels.has(key)) labels.set(key,String(row.ruleTitle??row.Rule??row['Rule Name']??row.reportName??row.Report??row.Concern??row.Category??row.Topic??row.ruleId??row.RuleID??'').trim());
    }
    return {counts,labels,total,ambiguous};
  }
  function normalizeConcernName(value){ return String(value??'').replace(/\([^)]*\)/g,' ').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,' ').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function summarizeConcernNameCounts(rows){
    const counts=new Map(), labels=new Map(); let total=0;
    for(const row of rows||[]){
      const value=row&&typeof row==='object'?(row.repName??row.Representative??row['Representative Name']??row['Agent Name']??row['Associate Name']??row.Rep??row.Name):row;
      const label=String(value??'').replace(/\([^)]*\)/g,' ').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,' ').replace(/\s*[—–-]+\s*$/,'').replace(/\s+/g,' ').trim(), key=normalizeConcernName(label);
      if(!key) continue;
      counts.set(key,(counts.get(key)||0)+1); if(!labels.has(key)) labels.set(key,label); total++;
    }
    return {counts,labels,total,uniqueNames:counts.size};
  }
  function concernOccurrenceKey(raw){
    const input=raw||{}, rep=normalizeConcernIdentity(input.repKey), rule=normalizeConcernIdentity(input.ruleId), run=normalizeConcernIdentity(input.runId||input.reportPeriod||input.reportDate);
    return rep&&rule&&run?`${rep}\u001f${rule}\u001f${run}`:'';
  }
  function classifyConcernHistory(raw){
    const appearances=Math.max(1,Math.floor(Number(raw?.appearances)||1)), relatedCoachingLast21=Math.max(0,Math.floor(Number(raw?.relatedCoachingLast21)||0));
    if(appearances===1) return {key:'new',label:'New'};
    if(appearances>=2&&relatedCoachingLast21<=1) return {key:'undercoached',label:'Undercoached'};
    if(appearances>=3&&relatedCoachingLast21>=3) return {key:'review-option',label:'Review Option'};
    return {key:relatedCoachingLast21>=2?'monitor':'repeat',label:relatedCoachingLast21>=2?'Monitor':'Repeat'};
  }
  function summarizeConcernHistory(rows){
    const occurrences=new Map();
    for(const row of rows||[]){ const key=concernOccurrenceKey(row); if(key&&!occurrences.has(key)) occurrences.set(key,row); }
    const byRepRule=new Map();
    for(const row of occurrences.values()){
      const key=`${normalizeConcernIdentity(row.repKey)}\u001f${normalizeConcernIdentity(row.ruleId)}`;
      byRepRule.set(key,(byRepRule.get(key)||0)+1);
    }
    return {occurrences,byRepRule};
  }
  return {normalizeFormatConfig,detectAutoFormat,percentHeader,formatDisplayValue,formatDisplayText,classifyCorrective,scoreOpportunity,opportunityPattern,concentration,evidenceConfidence,trendLabel,normalizeConcernIdentity,normalizeConcernName,summarizeConcernNameCounts,concernReportIdentity,concernRepReportKey,summarizeConcernReportCounts,concernOccurrenceKey,classifyConcernHistory,summarizeConcernHistory};
});
