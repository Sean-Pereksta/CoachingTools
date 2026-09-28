/* Monthly export adapter. Pure functions; no legacy mappings or global state changes. */
(function(root){
  'use strict';
  const VERSION=1, SEGMENTS=['commercial','consumer','insurance'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const display=x=>String(x??'').normalize('NFKC').trim().replace(/\s+/gu,' ');
  const key=x=>display(x).replace(/\p{Cf}/gu,'').toLowerCase();
  const header=x=>key(x).replace(/[_\s]+/g,' ');
  const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
  function date(x){
    const s=display(x), m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const d=m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:s;
    try{return validDate(d)?d:'';}catch(_){return '';}
  }
  function fiscal(x){const m=display(x).match(/(\d{4}-\d{2}-\d{2})\s*[-–—]\s*(\d{4}-\d{2}-\d{2})/);return m&&date(m[1])&&date(m[2])&&m[1]<=m[2]?{start:m[1],end:m[2],id:m[1]+'_'+m[2],label:display(x)}:null;}
  // Compare canonical content as well as this locator when deduplicating.
  function fingerprint(s){let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i);}return `monthly-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}-${s.length}`;}
  function decode(buffer){const b=new Uint8Array(buffer);return new TextDecoder(b[0]===255&&b[1]===254?'utf-16le':b[0]===254&&b[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(b).replace(/^\uFEFF/,'');}
  function delimited(text){
    // RFC-style quoting applies to both TSV and CSV, including embedded newlines.
    const first=text.split(/\r?\n/)[0], separator=first.includes('\t')?'\t':',';
    const rows=[],row=[];let value='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||!value) quoted=!quoted;else value+=c;}else if(!quoted&&(c===separator||c==='\n'||c==='\r')){row.push(value);value='';if(c!==separator){rows.push(row.splice(0));if(c==='\r'&&text[i+1]==='\n')i++;}}else value+=c;}
    if(quoted)throw new Error('Unclosed quoted field.');if(value||row.length){row.push(value);rows.push(row);}return rows;
  }
  function detect(aoa){
    const first=(aoa[0]||[]).map(header);
    if(['employee full name','wipers accepted','wipers offered'].every(x=>first.includes(x)))return 'wiper';
    if(aoa.slice(0,3).some(r=>r.some(c=>header(c)==='opportunity latest segment')) || (aoa[1]||[]).some(c=>SEGMENTS.includes(key(c))))return 'opportunity';
    return '';
  }
  function opportunityMapping(aoa){
    if(!detect(aoa)||!aoa.slice(0,3).every(r=>r.slice(0,3).every(c=>!display(c))))return null;
    const columns={};
    for(const segment of SEGMENTS)for(const [metric,label] of [['opportunities','opportunities'],['appointments','appointments'],['rate','appt rate']]){
      const matches=(aoa[1]||[]).map((v,i)=>key(v)===segment&&header(aoa[2]?.[i])===label?i:-1).filter(i=>i>=3);
      if(matches.length!==1)return null;columns[segment+':'+metric]=matches[0];
    }
    return {coach:0,name:1,period:2,headerRows:3,columns};
  }
  function cell(raw,rate=false){
    const s=display(raw);if(!s)return {value:null,status:'missing',raw:s};if(s==='*')return {value:null,status:'suppressed',raw:s};
    if(/^(n\/?a|not applicable|—)$/i.test(s))return {value:null,status:'not-applicable',raw:s};
    const n=Number(s.replace(/,/g,'').replace(/%$/,''));
    if(!/^-?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)%?$/.test(s)||!Number.isFinite(n)||n<0||(!rate&&!Number.isSafeInteger(n))||(!rate&&s.endsWith('%'))||(rate&&n>100))return {value:null,status:'invalid',raw:s};
    return {value:rate?(s.endsWith('%')?n/100:n):n,status:'valid',raw:s};
  }
  function source(aoa,name,manual){
    const kind=detect(aoa)|| (manual?'opportunity':'');if(!kind)throw new Error('Expected Rep Opportunity Performance or Rep Wiper Performance headers.');
    const canonical=JSON.stringify(aoa.filter(r=>r.some(c=>display(c))).map(r=>r.map(c=>String(c??'').normalize('NFKC').trim())));
    const result={id:fingerprint(canonical),canonical,name,kind,aoa:clone(aoa),rows:[],assignments:{},importedAt:new Date().toISOString()};
    if(kind==='opportunity'){
      const map=manual||opportunityMapping(aoa);result.mapping=map;
      if(!map){result.mappingRequired=true;return result;}
      const indices=[map.coach,map.name,map.period,...SEGMENTS.flatMap(s=>['opportunities','appointments','rate'].map(m=>map.columns[s+':'+m]))];
      if(indices.some(i=>!Number.isInteger(i)||i<0)||new Set(indices).size!==12||!Number.isInteger(map.headerRows)||map.headerRows<1)throw new Error('Choose twelve distinct columns and a valid first data row.');
      aoa.slice(map.headerRows).forEach((r,i)=>{if(!r.some(c=>display(c)))return;const segments={};for(const s of SEGMENTS)segments[s]=Object.fromEntries(['opportunities','appointments','rate'].map(m=>[m,cell(r[map.columns[s+':'+m]],m==='rate')]));result.rows.push({row:i+map.headerRows+1,coach:display(r[map.coach]),name:display(r[map.name]),period:fiscal(r[map.period]),periodLabel:display(r[map.period]),segments});});
    }else{
      const h=(aoa[0]||[]).map(header),col=x=>h.indexOf(x);
      aoa.slice(1).forEach((r,i)=>{if(!r.some(c=>display(c)))return;result.rows.push({row:i+2,name:display(r[col('employee full name')]),reportLabel:display(r[col('report date')]),reportDate:date(r[col('report date')]),accepted:cell(r[col('wipers accepted')]),offered:cell(r[col('wipers offered')])});});
    }
    return result;
  }
  function create(scope='retail'){return {version:VERSION,dateMode:'undated',scope,opportunity:null,wipers:[],coachAreas:{},allocations:{},consumerAsCash:true,blankSegments:'missing',partialAcknowledged:false};}
  // Existing saved bundles retain their original calculations until edited.
  function asUndated(bundle){return {...clone(bundle),dateMode:'undated',consumerAsCash:true};}
  function coachAssignments(b){
    const coaches=new Map();
    for(const r of b.opportunity?.rows||[]){
      if(!r.coach||!r.name)continue;
      const k=key(r.coach),c=coaches.get(k)||{key:k,coach:r.coach,cash:0,total:0,complete:true};
      for(const s of SEGMENTS){
        const g=r.segments[s],noActivity=b.blankSegments==='no-activity'&&Object.values(g).every(v=>v.status==='missing');
        if(g.opportunities.status!=='valid'&&!noActivity){c.complete=false;continue;}
        const n=noActivity?0:g.opportunities.value;c.total+=n;if(s==='consumer')c.cash+=n;
      }
      coaches.set(k,c);
    }
    return [...coaches.values()].map(c=>{const share=c.complete&&c.total>0?c.cash/c.total:null,automatic=share===null?'':share>0.15?'retail':'referral',override=b.coachAreas?.[c.key]||'';return {...c,share,automatic,override,area:override||automatic};});
  }
  function add(bundle,src){
    const b=clone(bundle);b.partialAcknowledged=false;
    if(src.kind==='opportunity'){
      if(b.opportunity?.canonical===src.canonical)return {bundle:b,duplicate:true};
      const oldPeriods=new Set((b.opportunity?.rows||[]).map(r=>r.period?.id)),newPeriods=new Set(src.rows.map(r=>r.period?.id));
      if(b.opportunity&&(b.dateMode==='undated'||[...newPeriods].some(p=>!oldPeriods.has(p)))){b.wipers=[];b.allocations={};if(b.dateMode==='undated')b.coachAreas={};}
      b.opportunity=clone(src);
    }else{if(b.wipers.some(f=>f.canonical===src.canonical))return {bundle:b,duplicate:true};b.wipers.push(clone(src));}
    return {bundle:b,duplicate:false};
  }
  function compile(b){
    if(b?.version!==VERSION)throw new Error('Unsupported monthly bundle version. Reimport the source exports.');
    const undated=b.dateMode==='undated',assignments=coachAssignments(b),coachAreas=new Map(assignments.map(c=>[c.key,c.area]));
    const issues=[],reps=[],teams=[],op=b?.opportunity,active=(b?.wipers||[]).filter(f=>!f.excluded&&!b.wipers.some(n=>!n.excluded&&n.replaces===f.id)),coverage=[];
    const issue=(code,message,extra={},severity='warning')=>issues.push({code,message,severity,...extra});
    if(!op)issue('opportunity-required','Upload one Opportunity file to establish the roster.',{},'blocker');
    if(op?.mappingRequired)issue('mapping-required','Review the changed Opportunity header layout and map its columns.',{},'blocker');
    const periods=[...new Map((op?.rows||[]).filter(r=>r.period).map(r=>[r.period.id,r.period])).values()];
    if(!undated&&op&&periods.length!==1)issue('fiscal-period','Opportunity rows must describe one fiscal reporting period.',{},'blocker');
    const period=!undated&&periods.length===1?periods[0]:null,byName=new Map();
    for(const r of op?.rows||[]){
      if(!r.name||!r.coach){issue('blank-identity','Opportunity row excluded: representative or coach is blank.',{source:op.name,row:r.row,counts:r.segments});continue;}
      if(!undated&&(!r.period||r.period.id!==period?.id)){issue('invalid-fiscal','Review this row’s fiscal period.',{source:op.name,row:r.row},'blocker');continue;}
      const area=b.scope==='mixed'?coachAreas.get(key(r.coach)):b.scope;
      if(!['retail','referral'].includes(area))issue('area-required',`Assign ${r.coach} to Monthly Retail or Monthly Referral.`,{coach:r.coach},'blocker');
      const rep={id:`${r.period?.id||op.id}|${key(r.coach)}|${key(r.name)}|${r.row}`,name:r.name,coach:r.coach,area,sourceRow:r.row,segments:{},wiper:{accepted:null,offered:null,rate:null,complete:false,contributions:[]}};
      for(const s of SEGMENTS){
        const g=r.segments[s],allBlank=Object.values(g).every(c=>c.status==='missing');
        let opportunities=g.opportunities.value,appointments=g.appointments.value,status='complete';
        if(allBlank&&b.blankSegments==='no-activity'){opportunities=0;appointments=0;status='no-activity';}
        else if(g.opportunities.status!=='valid'||g.appointments.status!=='valid'){status='incomplete';issue('segment-missing',`${s}: missing, suppressed or invalid counts.`,{source:op.name,row:r.row,name:r.name,counts:g});}
        if(opportunities!==null&&appointments!==null&&appointments>opportunities){status='invalid';issue('appointments-exceed',`${s}: appointments exceed opportunities.`,{source:op.name,row:r.row,name:r.name,counts:g});opportunities=appointments=null;}
        if(status==='incomplete')opportunities=appointments=null;
        const rate=opportunities>0?appointments/opportunities:null;
        if(rate!==null&&g.rate.value!==null&&Math.abs(rate-g.rate.value)>0.00051)issue('rate-reconciliation',`${s}: exported rate differs from raw counts.`,{source:op.name,row:r.row,name:r.name,exported:g.rate.raw,calculated:rate});
        rep.segments[s]={opportunities,appointments,rate,status};
      }
      reps.push(rep);if(!byName.has(key(rep.name)))byName.set(key(rep.name),[]);byName.get(key(rep.name)).push(rep);
    }
    byName.forEach(rs=>{if(rs.length>1)issue('duplicate-name',`${rs[0].name} has ${rs.length} Opportunity records; wiper allocations require review.`,{name:rs[0].name,candidates:rs.map(r=>r.id)});});
    const byId=new Map(reps.map(r=>[r.id,r])),seen=new Set(),buckets=new Map();let matched=0;
    for(const f of active){
      if(f.replaces&&!b.wipers.some(x=>x.id===f.replaces))issue('replacement-missing','The file selected for replacement no longer exists.',{source:f.name},'blocker');
      if(f.replaces&&b.wipers.some(x=>x.id===f.replaces&&x.replaces))issue('replacement-chain','Remove the earlier replacement before replacing this file.',{source:f.name},'blocker');
      const canonical=f.canonical;
      if(seen.has(canonical)){issue('duplicate-file','Duplicate file content excluded.',{source:f.name});continue;}seen.add(canonical);
      for(const reportDate of new Set(f.rows.map(r=>r.reportDate||r.reportLabel))){
        const a=f.assignments?.[reportDate]||{};
        if(a?.exclude)continue;
        if(!undated&&(!date(a.start)||!date(a.end)||a.start>a.end||!['activity-date','week-label','export-date'].includes(a.meaning)||!display(a.note))){
          issue('period-assignment',`Assign activity coverage and document the meaning of report label ${reportDate||'(blank)'}.`,{source:f.name,sourceId:f.id,reportDate},'blocker');continue;
        }
        if(!undated&&(!period||a.start<period.start||a.end>period.end)){issue('period-boundary','Coverage must be wholly within the fiscal period. Exclude or replace this aggregate; it cannot be prorated.',{source:f.name,sourceId:f.id,reportDate},'blocker');continue;}
        const bucket=undated?`${f.id}:${reportDate}`:`${a.start}_${a.end}`;
        if(!undated){coverage.push({source:f.name,sourceId:f.id,reportDate,start:a.start,end:a.end,meaning:a.meaning,note:a.note});buckets.set(bucket,{start:a.start,end:a.end});}
        for(const r of f.rows.filter(r=>(r.reportDate||r.reportLabel)===reportDate)){
          const contributionId=`${f.id}:${r.row}`,info={source:f.name,sourceId:f.id,row:r.row,name:r.name,accepted:r.accepted,offered:r.offered,reportDate,bucket,contributionId};
          if(!r.name){issue('blank-wiper-name','Blank-name wiper row excluded; its counts are retained here.',info);continue;}
          const candidates=byName.get(key(r.name))||[],allocation=b.allocations?.[contributionId];let target;
          if(allocation?.exclude&&display(allocation.reason)){issue('excluded-wiper',`Explicitly excluded: ${allocation.reason}`,info);continue;}
          if(allocation){target=byId.get(allocation.repId);if(!target||!display(allocation.reason)){issue('allocation-invalid','Choose a valid representative and document the allocation.',info,'blocker');continue;}}
          else if(candidates.length===1)target=candidates[0];
          if(!target){issue(candidates.length?'ambiguous-name':'unmatched-name',candidates.length?'Choose the recipient for these counts (different people / transfer).':'Match an approved alias or explicitly exclude this record.',{...info,candidates:candidates.map(r=>r.id)});continue;}
          if(r.accepted.status!=='valid'||r.offered.status!=='valid'||r.accepted.value>r.offered.value){issue('invalid-wiper','Missing, suppressed or invalid wiper counts; accepted must not exceed offered.',{...info,repId:target.id});target.wiper.invalid=true;continue;}
          if(target.wiper.contributions.some(c=>undated?c.bucket===bucket:c.start<=a.end&&a.start<=c.end)){issue('duplicate-bucket','This representative has duplicate contributions. Replace/remove the earlier file or explicitly exclude this row.',{...info,repId:target.id},'blocker');continue;}
          target.wiper.contributions.push({fileId:f.id,file:f.name,row:r.row,reportDate,bucket,...(undated?{importedAt:f.importedAt||''}:{start:a.start,end:a.end}),accepted:r.accepted.value,offered:r.offered.value,allocation:allocation||null});matched++;
        }
      }
    }
    const days=(start,end)=>Math.floor((Date.parse(end)-Date.parse(start))/86400000)+1;
    const covered=new Set();for(const c of coverage)for(let d=Date.parse(c.start);d<=Date.parse(c.end);d+=86400000)covered.add(d);
    const expectedDays=period?days(period.start,period.end):0;
    const coverageComplete=undated?null:expectedDays>0&&covered.size===expectedDays;
    if(period&&!coverageComplete)issue('coverage-gap',`${covered.size} of ${expectedDays} fiscal days have assigned wiper coverage; totals are partial.`);
    const distinctBuckets=[...buckets.values()].sort((a,c)=>a.start.localeCompare(c.start));
    for(let i=1;i<distinctBuckets.length;i++)if(distinctBuckets[i].start<=distinctBuckets[i-1].end)issue('coverage-overlap','Reporting buckets overlap. Review the files and replace or remove the overlapping component.',{},'blocker');
    for(const rep of reps){
      const w=rep.wiper,cs=w.contributions;
      if(cs.length){w.accepted=cs.reduce((n,c)=>n+c.accepted,0);w.offered=cs.reduce((n,c)=>n+c.offered,0);w.rate=w.offered>0?w.accepted/w.offered:null;}
      const repDays=undated?0:cs.reduce((n,c)=>n+days(c.start,c.end),0);
      w.complete=undated?cs.length>0&&!w.invalid:coverageComplete&&!w.invalid&&repDays===expectedDays;
      w.status=!cs.length?'missing':w.complete?'complete':'partial';
    }
    if(reps.some(r=>!r.wiper.complete))issue('rep-coverage',undated?'Representatives without valid wiper records retain missing/partial status.':'Representatives without every assigned reporting bucket retain missing/partial wiper status.');
    const uncertain=issues.some(i=>['blank-identity','blank-wiper-name','unmatched-name','ambiguous-name','excluded-wiper','invalid-wiper'].includes(i.code));
    for(const teamKey of new Set(reps.map(r=>`${r.area}|${key(r.coach)}`))){
      const rs=reps.filter(r=>`${r.area}|${key(r.coach)}`===teamKey),team={coach:rs[0].coach,area:rs[0].area,repCount:rs.length,segments:{},wiper:{}};
      for(const s of SEGMENTS){const valid=rs.filter(r=>r.segments[s].opportunities!==null),opportunities=valid.reduce((n,r)=>n+r.segments[s].opportunities,0),appointments=valid.reduce((n,r)=>n+r.segments[s].appointments,0);team.segments[s]={opportunities:valid.length?opportunities:null,appointments:valid.length?appointments:null,rate:opportunities>0?appointments/opportunities:null,status:valid.length===rs.length&&!issues.some(i=>i.code==='blank-identity')?'complete':'partial'};}
      const valid=rs.filter(r=>r.wiper.accepted!==null),accepted=valid.reduce((n,r)=>n+r.wiper.accepted,0),offered=valid.reduce((n,r)=>n+r.wiper.offered,0);
      team.wiper={accepted:valid.length?accepted:null,offered:valid.length?offered:null,rate:offered>0?accepted/offered:null,status:rs.every(r=>r.wiper.complete)&&!uncertain?'complete':'partial'};teams.push(team);
    }
    const partial=issues.some(i=>i.severity==='warning')||teams.some(t=>t.wiper.status!=='complete'||SEGMENTS.some(s=>t.segments[s].status!=='complete'));
    return {period,undated,coachAssignments:assignments,reps,teams,issues,coverage,coverageComplete,partial,matched,canApply:!!reps.length&&!issues.some(i=>i.severity==='blocker')&&(undated||!partial||b.partialAcknowledged),consumerAsCash:undated||!!b.consumerAsCash};
  }
  const title=s=>s[0].toUpperCase()+s.slice(1);
  function stats(rep,consumerAsCash){
    const row={Representative:rep.name||'',Coach:rep.coach};
    for(const s of SEGMENTS){const g=rep.segments[s];row[title(s)+' Opportunities']=g.opportunities;row[title(s)+' Appointments']=g.appointments;row[title(s)+' Appointment Rate']=g.rate===null?null:g.rate*100;}
    if(consumerAsCash){row['Cash Apps']=rep.segments.consumer.appointments;row['Cash Opps']=rep.segments.consumer.opportunities;row['Cash Appointment Rate']=row['Consumer Appointment Rate'];}
    return row;
  }
  function wipers(rep){return {Representative:rep.name||'',Coach:rep.coach,Accepted:rep.wiper.accepted,Offered:rep.wiper.offered,Declined:rep.wiper.offered===null?null:rep.wiper.offered-rep.wiper.accepted,'Wiper Rate':rep.wiper.rate===null?null:rep.wiper.rate*100,'Wiper Status':rep.wiper.status};}
  function toDataset(b,area){
    const out=compile(b);if(!out.canApply)throw new Error('Choose an Opportunity file and resolve the highlighted import issues.');
    const reps=out.reps.filter(r=>r.area===area),sv2=reps.map(r=>stats(r,out.consumerAsCash)),wiper=reps.map(wipers);
    const aoa=rows=>{const headers=Object.keys(rows[0]||{});return [headers,...rows.map(r=>headers.map(h=>r[h]))];};
    return {meta:{fileName:b.opportunity.name,totalRows:reps.length,sheetsCount:2,monthlyBundle:clone(b),monthlyArea:area,monthlyPeriod:out.period,monthlyUndated:out.undated,importedAt:b.importedAt||'',monthlyPartial:out.partial},workbook:{sheets:['Monthly Opportunity','Monthly Wipers'],data:{'Monthly Opportunity':{aoa:aoa(sv2)},'Monthly Wipers':{aoa:aoa(wiper)}}}};
  }
  function changes(previous,next,previousRoster=[]){
    const after=compile(next).reps,areas=new Set(after.map(r=>r.area)),before=(previous?.opportunity?compile(previous).reps:previousRoster).filter(r=>areas.has(r.area)),rows=[];
    for(const r of after){const same=before.find(p=>key(p.name)===key(r.name)&&key(p.coach)===key(r.coach)&&p.area===r.area);if(same)continue;const matches=before.filter(p=>key(p.name)===key(r.name)),newMatches=after.filter(p=>key(p.name)===key(r.name));rows.push({name:r.name,from:matches.length===1&&newMatches.length===1?matches[0].coach:'Not on this team',to:r.coach,type:matches.length===1&&newMatches.length===1?'Coach/area change':'Addition'});}
    for(const r of before)if(!after.some(p=>key(p.name)===key(r.name)&&key(p.coach)===key(r.coach)&&p.area===r.area))rows.push({name:r.name,from:r.coach,to:'Removed from this team',type:'Removal'});
    return rows;
  }
  const api={VERSION,SEGMENTS,clone,key,display,date,fiscal,fingerprint,decode,delimited,detect,opportunityMapping,cell,source,create,asUndated,coachAssignments,add,compile,stats,wipers,toDataset,changes};
  root.CoachToolsMonthly=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
