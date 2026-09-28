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
    if(first.includes('employee full name')&&['wipers accepted','count wipers accepted'].some(x=>first.includes(x))&&['wipers offered','count wipers offered'].some(x=>first.includes(x)))return 'wiper';
    if(aoa.slice(0,3).some(r=>r.some(c=>header(c)==='opportunity latest segment')) || (aoa[1]||[]).some(c=>SEGMENTS.includes(key(c))))return 'opportunity';
    return '';
  }
  function opportunityMapping(aoa){
    const metricRow=aoa.findIndex((r,i)=>i<8&&r.some(c=>header(c)==='opportunities')&&r.some(c=>header(c)==='appt rate'));
    if(metricRow<1)return null;
    const columns={}, fields=[], used=new Set();let segment='';
    for(let i=0;i<(aoa[metricRow]||[]).length;i++){
      const upper=key(aoa[metricRow-1]?.[i]);if(SEGMENTS.includes(upper))segment=upper;
      const label=display(aoa[metricRow][i]);if(!label||!segment)continue;
      const metric={'opportunities':'opportunities','appointments':'appointments','appt rate':'rate'}[header(label)];
      if(metric){if(columns[segment+':'+metric]!==undefined)return null;columns[segment+':'+metric]=i;}
      const base=title(segment)+' '+(metric==='rate'?'Appointment Rate':label.replace(/_/g,' ')), n=fields.filter(f=>f.base===base).length;
      const name=base+(n?' ('+(n+1)+')':'');
      const values=aoa.slice(metricRow+1).map(r=>display(r[i])),isRate=/rate|percent|%/i.test(label)||values.some(v=>v.endsWith('%'));const sample=values.filter(v=>v&&!v.endsWith('%')&&Number.isFinite(Number(v)));const inputUnit=sample.some(v=>Number(v)>1)?'percentage-points':'fraction';
      fields.push({name,base,index:i,segment,inputUnit,kind:isRate?'percentage':'number',storageUnit:isRate?'fraction':'number'});used.add(i);
    }
    if(SEGMENTS.some(s=>['opportunities','appointments','rate'].some(m=>columns[s+':'+m]===undefined)))return null;
    const first=Math.min(...used), identity=(aoa[metricRow]||[]).slice(0,first).map(header);
    const named=(labels,fallback)=>{const i=identity.findIndex(h=>labels.includes(h));return i<0?fallback:i;};
    if(first!==3&&first!==4)return null;
    return {manager:first===4?named(['manager','manager name'],0):null,coach:named(['coach','coach name'],first-3),name:named(['representative','employee full name'],first-2),period:named(['fiscal period','reporting period'],first-1),headerRows:metricRow+1,columns,fields};
  }
  const total=x=>/^(grand total|total|subtotal)$/i.test(display(x));
  function rowKind(r,map){
    if(map.manager!=null&&total(r[map.manager]))return 'grand';
    if(total(r[map.coach]))return map.manager!=null?'manager':'grand';
    if(total(r[map.name]))return 'coach';
    return 'detail';
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
      result.fields=map.fields||[];
      aoa.slice(map.headerRows).forEach((r,i)=>{
        if(!r.some(c=>display(c)))return;
        const segments={};for(const s of SEGMENTS)segments[s]=Object.fromEntries(['opportunities','appointments','rate'].map(m=>[m,cell(r[map.columns[s+':'+m]],m==='rate')]));
        const fields=Object.fromEntries(result.fields.map(f=>[f.name,{...numericCell(r[f.index],f.kind==='percentage',f.inputUnit),kind:f.kind}]));
        result.rows.push({row:i+map.headerRows+1,kind:rowKind(r,map),manager:map.manager==null?'':display(r[map.manager]),coach:display(r[map.coach]),name:display(r[map.name]),period:fiscal(r[map.period]),periodLabel:display(r[map.period]),segments,fields});
      });
    }else{
      const h=(aoa[0]||[]).map(header),col=(...labels)=>h.findIndex(v=>labels.includes(v));
      const coachCol=col('employee immediate supervisor name','coach','supervisor'), accepted=col('wipers accepted','count wipers accepted'),offered=col('wipers offered','count wipers offered');result.hasCoach=coachCol>=0;
      aoa.slice(1).forEach((r,i)=>{
        if(!r.some(c=>display(c)))return;
        const name=display(r[col('employee full name')]),coach=coachCol<0?'':display(r[coachCol]),reportLabel=display(r[col('report date')]);
        const kind=total(reportLabel)?'grand':total(coach)?'period':total(name)?'coach':'detail';
        result.rows.push({row:i+2,kind,coach,name,reportLabel,reportDate:date(reportLabel),accepted:cell(r[accepted]),offered:cell(r[offered])});
      });
    }
    return result;
  }
  function numericCell(raw,rate=false,inputUnit='fraction'){
    if(raw!==undefined&&raw!==null&&!display(raw))return {value:null,status:'blank',raw:''};
    if(rate){const c=cell(raw,true);if(c.value!==null&&!String(raw).trim().endsWith('%')&&inputUnit==='percentage-points')c.value/=100;return c;}
    const s=display(raw);if(!s||s==='*'||/^(n\/?a|not applicable|—)$/i.test(s))return cell(raw);
    const value=Number(s.replace(/,/g,''));return /^-?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)$/.test(s)&&Number.isFinite(value)?{value,status:'valid',raw:s}:{value:null,status:'invalid',raw:s};
  }
  function create(scope='retail'){return {version:VERSION,dateMode:'undated',scope,opportunity:null,wipers:[],coachAreas:{},allocations:{},consumerAsCash:true,blankSegments:'missing',partialAcknowledged:false};}
  // Existing saved bundles retain their original calculations until edited.
  function asUndated(bundle){return {...clone(bundle),dateMode:'undated',consumerAsCash:true};}
  function coachAssignments(b){
    const coaches=new Map();
    for(const r of b.opportunity?.rows||[]){
      if((r.kind&&r.kind!=='detail')||!r.coach||!r.name)continue;
      const k=key(r.coach),c=coaches.get(k)||{key:k,coach:r.coach,cash:0,total:0,complete:true};
      for(const s of SEGMENTS){
        const g=r.segments[s],noActivity=b.blankSegments==='no-activity'&&Object.values(g).every(v=>v.status==='missing');
        if(g.opportunities.status!=='valid'&&!noActivity){c.complete=false;continue;}
        const n=noActivity?0:g.opportunities.value;c.total+=n;if(s==='consumer')c.cash+=n;
      }
      coaches.set(k,c);
    }
    return [...coaches.values()].map(c=>{const share=c.complete&&c.total>0?c.cash/c.total:null,automatic=share===null?'':share>=0.15?'retail':'referral',override=b.coachAreas?.[c.key]||'';return {...c,share,automatic,override,area:override||automatic};});
  }
  function add(bundle,src){
    const b=clone(bundle);b.partialAcknowledged=false;if(src.mapping?.manager!=null||src.hasCoach)b.scope='mixed';
    if(src.kind==='opportunity'){
      if(b.opportunity?.canonical===src.canonical)return {bundle:b,duplicate:true};
      const oldPeriods=new Set((b.opportunity?.rows||[]).filter(r=>!r.kind||r.kind==='detail').map(r=>r.period?.id||r.periodLabel)),newPeriods=new Set(src.rows.filter(r=>!r.kind||r.kind==='detail').map(r=>r.period?.id||r.periodLabel));
      if(b.opportunity&&((b.dateMode==='undated'&&src.mapping?.manager==null)||[...newPeriods].some(p=>p&&!oldPeriods.has(p)))){b.wipers=[];b.allocations={};if(b.dateMode==='undated')b.coachAreas={};}
      b.opportunity=clone(src);
    }else{if(b.wipers.some(f=>f.canonical===src.canonical))return {bundle:b,duplicate:true};b.wipers.push(clone(src));}
    return {bundle:b,duplicate:false};
  }
  function compileLegacy(b){
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
  // The same compiler serves individual uploads, Clean Upload and Update Data.
  // Older exports without source-owned hierarchy keep their explicit legacy allocations.
  function compile(b,filter={}){
    const modern=b.opportunity?.mapping?.manager!=null||(b.opportunity?.rows||[]).some(r=>r.kind&&r.kind!=='detail')||(b.wipers||[]).some(f=>f.hasCoach);
    if(!modern)return compileLegacy(b);
    if(b.version!==VERSION)throw new Error('Unsupported monthly bundle version.');
    const issues=[],issue=(code,message,extra={},severity='warning')=>issues.push({code,message,severity,...extra});
    const op=b.opportunity, opRows=op?.rows||[], details=opRows.filter(r=>!r.kind||r.kind==='detail');
    if(!op)issue('opportunity-required','Upload one Opportunity file to establish the hierarchy.',{},'blocker');
    if(op?.mappingRequired)issue('mapping-required','Review the Opportunity column mapping.',{},'blocker');
    const fieldMetadata=Object.fromEntries((op?.fields||[]).map(f=>[f.name,{...f}]));
    const segmentsFor=r=>Object.fromEntries(SEGMENTS.map(s=>{
      const g=r?.segments?.[s], noActivity=b.blankSegments==='no-activity'&&g&&Object.values(g).every(c=>c.status==='missing');
      const opportunities=noActivity?0:g?.opportunities?.value??null,appointments=noActivity?0:g?.appointments?.value??null;
      const valid=opportunities!==null&&appointments!==null&&appointments<=opportunities;
      const rate=valid&&opportunities>0?appointments/opportunities:null,exportedRate=g?.rate?.value??null;
      if(r&&appointments!==null&&opportunities!==null&&appointments>opportunities)issue('appointments-exceed',`${s}: appointments exceed opportunities.`,{row:r.row,source:op?.name});
      if(rate!==null&&exportedRate!==null&&Math.abs(rate-exportedRate)>0.00051)issue('rate-reconciliation',`${s}: exported rate differs from counts beyond display rounding.`,{row:r.row,source:op?.name,exported:exportedRate,calculated:rate});
      return [s,{opportunities,appointments:appointments!==null&&opportunities!==null&&appointments>opportunities?null:appointments,rate,exportedRate,status:valid?'complete':'incomplete'}];
    }));
    const sumSegments=rows=>Object.fromEntries(SEGMENTS.map(s=>{
      const all=rows.map(r=>r.segments[s]),valid=all.filter(g=>g.opportunities!==null&&g.appointments!==null),opps=all.filter(g=>g.opportunities!==null),apps=all.filter(g=>g.appointments!==null),opportunities=opps.length?opps.reduce((n,g)=>n+g.opportunities,0):null,appointments=apps.length?apps.reduce((n,g)=>n+g.appointments,0):null;
      return [s,{opportunities,appointments,rate:opportunities>0&&appointments!==null&&valid.length===rows.length?appointments/opportunities:null,status:valid.length&&valid.length===rows.length?'complete':'partial'}];
    }));
    const fieldsFor=r=>Object.fromEntries(Object.entries(r.fields||{}).map(([name,c])=>[name,{...c}]));
    const mergedFields=rows=>Object.fromEntries(Object.entries(fieldMetadata).map(([name,m])=>{
      const valid=rows.map(r=>r.fields?.[name]).filter(c=>c?.status==='valid'),sum=valid.reduce((n,c)=>n+c.value,0);
      return [name,{value:valid.length?(m.kind==='percentage'?sum/valid.length:sum):null,status:valid.length?'valid':'missing',kind:m.kind,coverage:`${valid.length}/${rows.length}`,method:m.kind==='percentage'?'Average of eligible representatives':'Sum'}];
    }));
    const mapping=new Map(),coaches=new Map();
    for(const r of opRows){
      if(!r.coach||total(r.coach)||r.kind==='grand'||r.kind==='manager')continue;
      const k=key(r.coach);coaches.set(k,r.coach);if(!mapping.has(k))mapping.set(k,new Map());if(r.manager&&!total(r.manager))mapping.get(k).set(key(r.manager),r.manager);
    }
    const managerFor=coach=>{const ms=mapping.get(key(coach));return ms?.size===1?[...ms.values()][0]:'';};
    for(const [coach,ms] of mapping)if(ms.size>1)issue('manager-conflict',`${coaches.get(coach)} has conflicting manager assignments. Activity is in Unassigned Manager.`,{coach:coaches.get(coach),managers:[...ms.values()]});
    const reps=[],repMap=new Map(),seenOp=new Map();
    for(const r of details){
      if(!r.coach||!r.name){issue('blank-identity','Opportunity detail lacks a representative or coach.',{row:r.row,source:op?.name});continue;}
      const identity=key(r.coach)+'|'+key(r.name),periodKey=identity+'|'+r.periodLabel;
      const signature=JSON.stringify([r.manager,r.segments,r.fields]);
      if(seenOp.has(periodKey)){if(seenOp.get(periodKey)!==signature)issue('opportunity-overlap','Conflicting Opportunity detail for the same coach, representative and period.',{row:r.row,source:op.name},'blocker');continue;}seenOp.set(periodKey,signature);
      const part={segments:segmentsFor(r),fields:fieldsFor(r)};
      let rep=repMap.get(identity);
      if(!rep){rep={id:'op|'+identity,name:r.name,coach:r.coach,manager:managerFor(r.coach),managerProvenance:'Opportunity Coach → Manager',sourceRow:r.row,hasOpportunity:true,ranked:true,parts:[],segments:part.segments,fields:part.fields,wiper:{contributions:[]}};reps.push(rep);repMap.set(identity,rep);}
      rep.parts.push(part);
    }
    for(const rep of reps)if(rep.parts.length>1){
      rep.segments=sumSegments(rep.parts);
      // Period-level percentages cannot be pooled without eligible denominators.
      for(const [name,m] of Object.entries(fieldMetadata)){
        const cells=rep.parts.map(p=>p.fields[name]),values=cells.filter(c=>c?.status==='valid').map(c=>c.value);
        rep.fields[name]=m.kind==='percentage'&&new Set(values).size>1?{value:null,status:'conflicting',raw:'Multiple reporting periods; select a single period'}:{value:values.length?(m.kind==='percentage'?values[0]:values.reduce((a,c)=>a+c,0)):null,status:values.length?'valid':'missing'};rep.fields[name].kind=m.kind;
      }
    }
    const exported=(kind,match)=>{const rows=opRows.filter(r=>r.kind===kind&&match(r));if(rows.length>1){issue('subtotal-conflict',`Multiple ${kind} totals require review; calculated detail is used.`,{rows:rows.map(r=>r.row)});return null;}return rows[0]||null;};
    const sourceTotals=(rows,record,label)=>{
      const calculated=sumSegments(rows),segments=record?segmentsFor(record):calculated;
      if(record)for(const s of SEGMENTS)for(const m of ['opportunities','appointments'])if(segments[s][m]!==null&&calculated[s][m]!==null&&segments[s][m]!==calculated[s][m])issue('subtotal-reconciliation',`${label}: exported ${s} ${m} differs from detail.`,{exported:segments[s][m],calculated:calculated[s][m],row:record.row,source:op.name});
      return {segments,calculatedSegments:calculated,totalSource:record?'Exported total':'Calculated total',fields:record?fieldsFor(record):mergedFields(rows)};
    };
    const coachAssignments=[];
    for(const [k,coach] of coaches){
      const rows=reps.filter(r=>key(r.coach)===k),record=exported('coach',r=>key(r.coach)===k),totals=sourceTotals(rows,record,coach);
      const complete=SEGMENTS.every(s=>totals.segments[s].opportunities!==null&&(record||totals.segments[s].status==='complete')),cash=totals.segments.consumer.opportunities,totalCount=complete?SEGMENTS.reduce((n,s)=>n+totals.segments[s].opportunities,0):null;
      const share=totalCount>0?cash/totalCount:null,automatic=share===null?'unclassified':share>=.15?'retail':'referral',override=b.coachAreas?.[k]||'',area=override||automatic;
      if(share===null)issue('area-required',`${coach}: Unclassified / Needs Review — missing or zero opportunities.`,{coach});
      coachAssignments.push({key:k,coach,cash,total:totalCount,complete,share,automatic,override,area,manager:managerFor(coach),...totals});
    }
    const assignmentMap=new Map(coachAssignments.map(c=>[c.key,c]));
    const active=(b.wipers||[]).filter(f=>!f.excluded&&!b.wipers.some(n=>!n.excluded&&n.replaces===f.id));
    const seenFiles=new Set(),seenWiper=new Map(),unattributedSources=new Map(),coverage=[],wiperSummaries=[];let matched=0;
    for(const f of active){
      if(seenFiles.has(f.canonical))continue;seenFiles.add(f.canonical);
      if(f.replaces&&!b.wipers.some(x=>x.id===f.replaces))issue('replacement-missing','The selected replacement source is missing.',{source:f.name},'blocker');
      if(f.replaces&&b.wipers.some(x=>x.id===f.replaces&&x.replaces))issue('replacement-chain','Remove the earlier replacement before replacing this file.',{source:f.name},'blocker');
      for(const label of new Set(f.rows.filter(r=>r.kind!=='grand').map(r=>r.reportDate||r.reportLabel)))coverage.push({source:f.name,sourceId:f.id,reportDate:label,reportLabel:f.rows.find(r=>(r.reportDate||r.reportLabel)===label)?.reportLabel||label,included:!f.assignments?.[label]?.exclude});
      for(const r of f.rows){
        const reportDate=r.reportDate||r.reportLabel,contributionId=f.id+':'+r.row,allocation=b.allocations?.[contributionId];
        if(f.assignments?.[reportDate]?.exclude)continue;
        if(r.kind&&r.kind!=='detail'){wiperSummaries.push({file:f,row:r});continue;}
        const info={source:f.name,sourceId:f.id,row:r.row,name:r.name,coach:r.coach,reportDate,contributionId,accepted:r.accepted,offered:r.offered};
        if(allocation?.exclude&&display(allocation.reason)){issue('excluded-wiper','Explicit exclusion: '+allocation.reason,info);continue;}
        let coach=r.coach;
        if(!coach&&f.hasCoach)coach='Unassigned Coach';
        else if(!coach){const matches=reps.filter(p=>key(p.name)===key(r.name)&&p.hasOpportunity);if(matches.length===1)coach=matches[0].coach;else coach='Unassigned Coach';}
        if(f.hasCoach&&!r.coach)issue('wiper-coach-missing','Wiper coach is blank; retained in Unassigned Coach.',info);
        let name=r.name,identity=key(coach)+'|'+key(name),target=repMap.get(identity);
        if(allocation?.repId){const chosen=reps.find(p=>p.id===allocation.repId);if(!chosen||!display(allocation.reason)||(f.hasCoach&&key(chosen.coach)!==key(coach))){issue('allocation-invalid','An alias must preserve the Wiper source coach. Choose a matching representative under that coach.',info,'blocker');continue;}target=chosen;identity=key(target.coach)+'|'+key(target.name);}
        if(!target){
          const unmatched=!!name;name=name||'Unattributed Representative';identity=key(coach)+'|'+(unmatched?key(name):'__unattributed');target=repMap.get(identity);
          if(!target){target={id:'wiper|'+identity,name,coach,manager:managerFor(coach),managerProvenance:managerFor(coach)?'Derived from Opportunity coach mapping':'Unresolved',sourceRow:r.row,hasOpportunity:false,ranked:unmatched,segments:segmentsFor(null),fields:{},wiper:{contributions:[]}};reps.push(target);repMap.set(identity,target);issue(unmatched?'wiper-only-rep':'unattributed-wiper',unmatched?'Wiper activity retained under its source coach; Opportunity data unavailable.':'Activity retained as Unattributed Representative; excluded from representative ranking.',info);}
        }
        coaches.set(key(coach),coach);
        if(r.accepted.status!=='valid'||r.offered.status!=='valid'||r.accepted.value>r.offered.value){target.wiper.invalid=true;issue('invalid-wiper','Invalid or unavailable Wiper counts; not converted to zero.',info);continue;}
        // A date/coach/person is one source contribution, regardless of filename.
        // Legacy undated labels remain file-scoped when no report label is present.
        if(!r.name){const unattributedKey=reportDate+'|'+key(coach),prior=unattributedSources.get(unattributedKey);if(prior&&prior!==f.id){issue('duplicate-bucket','Unattributed activity overlaps another source. Select a replacement or exclude the row.',info,'blocker');continue;}unattributedSources.set(unattributedKey,f.id);}
        const bucket=(reportDate||f.id)+'|'+identity+(!r.name?'|'+f.id+':'+r.row:''),signature=JSON.stringify([r.accepted.value,r.offered.value]);
        if(seenWiper.has(bucket)){
          if(seenWiper.get(bucket)!==signature)issue('duplicate-bucket','Conflicting overlapping Wiper records. Select the corrected source as a replacement or explicitly exclude the conflicting row.',info,'blocker');
          else issue('duplicate-contribution','Identical overlapping Wiper activity counted once.',info);
          continue;
        }
        seenWiper.set(bucket,signature);target.wiper.contributions.push({fileId:f.id,file:f.name,row:r.row,reportDate,reportLabel:r.reportLabel,bucket,coach,accepted:r.accepted.value,offered:r.offered.value,allocation:allocation||null});matched++;
      }
    }
    for(const rep of reps){
      const cs=rep.wiper.contributions,accepted=cs.length?cs.reduce((n,c)=>n+c.accepted,0):null,offered=cs.length?cs.reduce((n,c)=>n+c.offered,0):null;
      Object.assign(rep.wiper,{accepted,offered,rate:offered>0?accepted/offered:null,complete:cs.length>0&&!rep.wiper.invalid,status:!cs.length?'missing':rep.wiper.invalid?'partial':'complete'});
      rep.area=assignmentMap.get(key(rep.coach))?.area||'unclassified';rep.manager=managerFor(rep.coach);
    }
    const sumWipers=rows=>{const valid=rows.filter(r=>r.wiper.accepted!==null),accepted=valid.length?valid.reduce((n,r)=>n+r.wiper.accepted,0):null,offered=valid.length?valid.reduce((n,r)=>n+r.wiper.offered,0):null;return {accepted,offered,rate:offered>0?accepted/offered:null,status:valid.length===0?'missing':rows.every(r=>r.wiper.complete||r.wiper.status==='complete')?'complete':'partial',missingRepresentatives:rows.filter(r=>r.wiper.accepted===null).length};};
    for(const {file,row} of wiperSummaries){
      if(row.kind==='grand'&&Object.values(file.assignments||{}).some(a=>a.exclude))continue;
      // Reconcile within this file's detail, independent of identical rows deduped across files.
      const ds=file.rows.filter(r=>(!r.kind||r.kind==='detail')&&!file.assignments?.[r.reportDate||r.reportLabel]?.exclude&&(row.kind==='grand'||(r.reportDate||r.reportLabel)===(row.reportDate||row.reportLabel))&&(row.kind!=='coach'||key(r.coach)===key(row.coach))&&!b.allocations?.[file.id+':'+r.row]?.exclude);
      for(const m of ['accepted','offered']){const valid=ds.filter(r=>r.accepted.status==='valid'&&r.offered.status==='valid'&&r.accepted.value<=r.offered.value),calculated=valid.reduce((n,r)=>n+r[m].value,0);if(row[m].value!==null&&row[m].value!==calculated)issue('wiper-reconciliation',`Wiper ${row.kind} ${m} differs from included detail.`,{source:file.name,row:row.row,exported:row[m].value,calculated});}
    }
    const teams=[...coaches].map(([k,coach])=>{
      const rs=reps.filter(r=>key(r.coach)===k),a=assignmentMap.get(k),opReps=rs.filter(r=>r.hasOpportunity);
      return {coach,manager:managerFor(coach),managerProvenance:managerFor(coach)?'Opportunity Coach → Manager':'Unresolved',area:a?.area||'unclassified',share:a?.share??null,repCount:rs.filter(r=>r.ranked).length,...(a?{segments:a.segments,calculatedSegments:a.calculatedSegments,totalSource:a.totalSource,fields:a.fields}:sourceTotals(opReps,null,coach)),wiper:sumWipers(rs)};
    });
    const selectedReps=reps.filter(r=>(!filter.manager||key(r.manager||'Unassigned Manager')===key(filter.manager))&&(!filter.area||filter.area==='all'||r.area===filter.area)&&(!filter.coach||key(r.coach)===key(filter.coach))&&(!filter.selection||filter.selection.some(([name,coach])=>key(name)===key(r.name)&&key(coach)===key(r.coach))));
    const selectedTeams=teams.filter(t=>(!filter.manager||key(t.manager||'Unassigned Manager')===key(filter.manager))&&(!filter.area||filter.area==='all'||t.area===filter.area)&&(!filter.coach||key(t.coach)===key(filter.coach))).map(t=>{
      if(!filter.selection)return t;
      const rs=selectedReps.filter(r=>key(r.coach)===key(t.coach));if(rs.length===reps.filter(r=>key(r.coach)===key(t.coach)).length)return t;return {...t,...sourceTotals(rs.filter(r=>r.hasOpportunity),null,t.coach),totalSource:'Filtered total',wiper:sumWipers(rs),repCount:rs.filter(r=>r.ranked).length};
    }).filter(t=>!filter.selection||t.repCount||t.wiper.accepted!==null);
    const managerNames=new Map(opRows.filter(r=>r.kind==='manager'&&r.manager&&!total(r.manager)).map(r=>[key(r.manager),r.manager]));
    for(const t of selectedTeams)managerNames.set(key(t.manager||'Unassigned Manager'),t.manager||'Unassigned Manager');
    const managers=[];
    for(const [mk,manager] of managerNames){
      if(filter.manager&&mk!==key(filter.manager))continue;
      const ts=selectedTeams.filter(t=>key(t.manager||'Unassigned Manager')===mk),rs=selectedReps.filter(r=>key(r.manager||'Unassigned Manager')===mk),filtered=!!((filter.area&&filter.area!=='all')||filter.coach||(filter.selection&&rs.length!==reps.filter(r=>key(r.manager||'Unassigned Manager')===mk).length));
      if(!ts.length&&filtered)continue;
      const record=filtered||manager==='Unassigned Manager'?null:exported('manager',r=>key(r.manager)===mk);
      const totals=sourceTotals(rs.filter(r=>r.hasOpportunity),record,manager);
      if(!record){totals.segments=sumSegments(ts);totals.fields=mergedFields(rs.filter(r=>r.hasOpportunity));}
      if(filtered)totals.totalSource='Filtered total';
      const totalCount=SEGMENTS.every(s=>totals.segments[s].opportunities!==null)?SEGMENTS.reduce((n,s)=>n+totals.segments[s].opportunities,0):null;
      managers.push({manager,coach:manager,coachCount:ts.length,repCount:rs.filter(r=>r.ranked).length,share:totalCount>0?totals.segments.consumer.opportunities/totalCount:null,...totals,wiper:sumWipers(rs)});
    }
    const overall=sourceTotals(selectedReps.filter(r=>r.hasOpportunity),Object.keys(filter).length?null:exported('grand',()=>true),'Grand total');overall.wiper=sumWipers(selectedReps);if(Object.keys(filter).length)overall.totalSource='Filtered total';
    const sourcePeriods=[...new Set(details.map(r=>r.periodLabel))];
    return {period:null,undated:true,sourcePeriods,coachAssignments,reps:selectedReps,teams:selectedTeams,managers,overall,fieldMetadata,issues,coverage,coverageComplete:null,partial:issues.length>0||teams.some(t=>t.wiper.status!=='complete'),matched,consumerAsCash:true,canApply:!!details.length&&!issues.some(i=>i.severity==='blocker')};
  }

  const title=s=>s[0].toUpperCase()+s.slice(1);
  function stats(rep,consumerAsCash){
    const row={Representative:rep.name||'',Coach:rep.coach,Manager:rep.manager||'Unassigned Manager','Manager Source':rep.managerProvenance||'Opportunity','Total Source':rep.totalSource||'Representative detail'};
    for(const [name,c] of Object.entries(rep.fields||{}))row[name]=c.value===null?null:c.value*(c.kind==='percentage'||/rate|percent|%/i.test(name)?100:1);
    for(const s of SEGMENTS){const g=rep.segments[s];row[title(s)+' Opportunities']=g.opportunities;row[title(s)+' Appointments']=g.appointments;row[title(s)+' Appointment Rate']=g.rate===null?null:g.rate*100;}
    const totalCount=SEGMENTS.every(s=>rep.segments[s].opportunities!==null)?SEGMENTS.reduce((n,s)=>n+rep.segments[s].opportunities,0):null;row['Consumer/Cash Opportunity Share']=totalCount>0?rep.segments.consumer.opportunities/totalCount*100:null;
    if(consumerAsCash){row['Cash Apps']=rep.segments.consumer.appointments;row['Cash Opps']=rep.segments.consumer.opportunities;row['Cash Appointment Rate']=row['Consumer Appointment Rate'];}
    return row;
  }
  function wipers(rep){return {Representative:rep.name||'',Coach:rep.coach,Manager:rep.manager||'Unassigned Manager','Manager Source':rep.managerProvenance||'Derived from Opportunity coach mapping',Accepted:rep.wiper.accepted,Offered:rep.wiper.offered,Declined:rep.wiper.offered===null?null:rep.wiper.offered-rep.wiper.accepted,'Wiper Rate':rep.wiper.rate===null?null:rep.wiper.rate*100,'Wiper Status':rep.wiper.status==='missing'?'No Wiper Data':rep.wiper.status};}
  function toDataset(b,area){
    const out=compile(b);if(!out.canApply)throw new Error('Choose an Opportunity file and resolve the highlighted import issues.');
    const reps=out.reps.filter(r=>r.area===area),sv2=reps.map(r=>stats(r,out.consumerAsCash)),wiper=reps.map(wipers);
    const aoa=rows=>{const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))];return [headers,...rows.map(r=>headers.map(h=>r[h]))];};
    return {meta:{fileName:b.opportunity.name,totalRows:reps.length,sheetsCount:2,monthlyBundle:clone(b),monthlyArea:area,monthlyPeriod:out.period,monthlyUndated:out.undated,importedAt:b.importedAt||'',monthlyPartial:out.partial},workbook:{sheets:['Monthly Opportunity','Monthly Wipers'],data:{'Monthly Opportunity':{aoa:aoa(sv2)},'Monthly Wipers':{aoa:aoa(wiper)}}}};
  }
  function changes(previous,next,previousRoster=[]){
    const after=compile(next).reps,areas=new Set(after.map(r=>r.area)),before=(previous?.opportunity?compile(previous).reps:previousRoster).filter(r=>areas.has(r.area)),rows=[];
    for(const r of after){const same=before.find(p=>key(p.name)===key(r.name)&&key(p.coach)===key(r.coach)&&p.area===r.area);if(same)continue;const matches=before.filter(p=>key(p.name)===key(r.name)),newMatches=after.filter(p=>key(p.name)===key(r.name));rows.push({name:r.name,from:matches.length===1&&newMatches.length===1?matches[0].coach:'Not on this team',to:r.coach,type:matches.length===1&&newMatches.length===1?'Coach/area change':'Addition'});}
    for(const r of before)if(!after.some(p=>key(p.name)===key(r.name)&&key(p.coach)===key(r.coach)&&p.area===r.area))rows.push({name:r.name,from:r.coach,to:'Removed from this team',type:'Removal'});
    return rows;
  }
  const api={VERSION,SEGMENTS,clone,key,display,date,fiscal,fingerprint,decode,delimited,detect,opportunityMapping,cell,numericCell,source,create,asUndated,coachAssignments,add,compile,stats,wipers,toDataset,changes};
  root.CoachToolsMonthly=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
