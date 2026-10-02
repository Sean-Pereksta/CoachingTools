/* Dated numerical observations. Independent of the legacy event/count engine.
 * Values use percentage points and seconds; dates use UTC calendar days.
 */
(function(root){
  'use strict';
  const DAY=86400000, WEEK=7*DAY, VERSION=1;
  const SOURCES=['weeklyRetail','weeklyReferral'];
  const key=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const copy=v=>JSON.parse(JSON.stringify(v));
  const sum=vs=>vs.reduce((a,b)=>a+b,0);
  const mean=vs=>vs.length?sum(vs)/vs.length:null;
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function resultUnit(m,summary){
    const base=m.kind==='percentage'?'%':m.kind==='duration'?'seconds':m.kind;
    if(summary==='validPeriods')return 'periods';
    if(summary==='relativeChange')return '% relative change';
    if(summary==='slope')return (m.kind==='percentage'?'percentage points':base)+' / week';
    if(summary==='change'&&m.kind==='percentage')return 'percentage points';
    return base;
  }
  const iso=ms=>new Date(ms).toISOString().slice(0,10);
  function day(value){
    if(value instanceof Date)return Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate());
    if(typeof value==='number')return Number.isFinite(value)&&value>0?Date.UTC(1899,11,30)+Math.floor(value)*DAY:NaN;
    const s=String(value??'').trim();let y,m,d,hit;
    if((hit=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)))[,y,m,d]=hit;
    else if((hit=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/))){[,m,d,y]=hit;if(y.length===2)y=String(+y<70?2000+(+y):1900+(+y));}
    else if((hit=s.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})$/i))){m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(hit[1].slice(0,3).toLowerCase())+1;d=hit[2];y=hit[3];}
    else return NaN;
    const ms=Date.UTC(+y,+m-1,+d), dt=new Date(ms);
    return dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?ms:NaN;
  }
  function cell(raw,def={}){
    if(raw==null||String(raw).trim()==='')return {value:null,status:'missing',raw};
    const s=String(raw).trim();
    if(/^(?:n\/?a|unavailable|null|nan|—|-)$/i.test(s))return {value:null,status:'unavailable',raw};
    if(/^(?:suppressed|\*+|<\s*\d+)$/i.test(s))return {value:null,status:'suppressed',raw};
    if(def.kind==='percentage'&&!s.endsWith('%')&&!['fraction','percentage-points'].includes(def.inputUnit))return {value:null,status:'unavailable',raw,reason:'Percentage scale is unclear. Edit this field’s unit.'};
    let n;
    if(def.kind==='duration'&&s.includes(':')){
      const parts=s.split(':').map(Number);
      if(parts.length<2||parts.length>3||parts.some(v=>!Number.isFinite(v)||v<0)||parts.slice(1).some(v=>v>=60))n=NaN;
      else n=parts.reduce((acc,v)=>acc*60+v,0);
    }else{
      const cleaned=s.replace(/,/g,'').replace(/^\$/,'').replace(/%$/,'');
      n=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cleaned)?Number(cleaned):NaN;
      if(def.kind==='percentage'&&!s.endsWith('%')&&def.inputUnit==='fraction')n=Number((n*100).toPrecision(15));
      if(def.kind==='duration')n*=({days:86400,minutes:60,seconds:1}[def.inputUnit]||1);
    }
    const invalid=!Number.isFinite(n)||(def.nonnegative!==false&&n<0)||(def.kind==='count'&&!Number.isInteger(n))||(def.kind==='percentage'&&(n<0||(def.bounded!==false&&n>100)));
    return {value:invalid?null:n,status:invalid?'invalid':'valid',raw,unit:def.kind==='percentage'?'percentage-points':def.kind==='duration'?'seconds':def.kind||'number'};
  }
  function defaultConfig(source,headers=[],rows=[]){
    const fields={};
    const counts=['Total Opportunities','Total Appointments','Consumer Opportunities','Consumer Appointments','Insurance Opportunities','Insurance Appointments','Commercial Opportunities','Commercial Appointments','ACD Calls',...(source==='weeklyRetail'?['Wiper Jobs','Wiper Count']:['Wipers Asked','Wipers Accept'])];
    const rates=['Total Opportunity Rate','Total Appointment Rate','Consumer Appointment Rate','Insurance Appointment Rate','Commercial Appointment Rate','Wiper Rate','% Available','ITAC %','% ACW','Email Collection Rate All Providers','SMS Opt-In %','Total Retention Rate','Total Net Conversion Rate'];
    for(const h of headers){
      if(counts.some(c=>key(c)===key(h)))fields[h]={kind:'count',inputUnit:'number',behavior:'activity'};
      else if(rates.some(c=>key(c)===key(h)))fields[h]={kind:'percentage',inputUnit:'fraction',behavior:'rate',bounded:key(h)!=='total opportunity rate'};
      else if(key(h)==='average acd time')fields[h]={kind:'duration',inputUnit:'days',behavior:'average'};
      else if(/^(inbound calls per hour|outbound cph)$/i.test(h))fields[h]={kind:'number',inputUnit:'number',behavior:'average'};
      else if(!/^(name|representative|agent name|associate name|sheet|coach|team|manager|manager name|.*date|.* id)$/i.test(h)&&!h.startsWith('_')){
        const values=rows.map(r=>r[h]).filter(v=>v!=null&&String(v).trim()!==''&&!/^(n\/?a|unavailable|null|nan|—|-|suppressed|\*+|<\s*\d+)$/i.test(String(v).trim()));
        if(values.length&&values.some(v=>/^[+-]?(?:\$?\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(String(v).trim()))){
          const percentage=/%|rate|percentage/i.test(h)||values.some(v=>String(v).trim().endsWith('%'));
          fields[h]={kind:percentage?'percentage':'number',inputUnit:percentage?'':'number',behavior:percentage?'rate':'average',nonnegative:percentage};
        }
      }
    }
    const column=(names,fallback)=>headers.find(h=>names.includes(key(h)))||fallback;
    return {version:VERSION,category:'datedStats',source,repField:column(['name','representative','agent name','associate name'],'Name'),coachField:column(['sheet','coach','team','job coach'],'Sheet'),managerField:column(['manager','manager name'],'Manager'),dateField:column(['date','stats date','report date','week date'],'Date'),scopeField:'',fields,calendar:{reviewed:false,frequency:'week',label:'',offsetDays:0},corrections:'replace'};
  }
  function period(raw,calendar={}){
    const ms=day(raw);if(!Number.isFinite(ms))return null;
    if(!calendar.reviewed||calendar.frequency==='observation')return {start:iso(ms),end:iso(ms),startMs:ms,endMs:ms,key:iso(ms)+'/'+iso(ms),sourceDate:iso(ms),frequency:'observation'};
    let start=ms,end=ms;
    if(calendar.frequency==='week'){
      if(calendar.label==='ending')start=ms-6*DAY;
      else if(calendar.label==='beginning')end=ms+6*DAY;
      else if(calendar.label==='publication'&&Number.isInteger(Number(calendar.offsetDays))){start=ms+Number(calendar.offsetDays)*DAY;end=start+6*DAY;}
      else throw new Error('Choose whether the weekly date begins, ends, or publishes the reporting period.');
    }else if(calendar.frequency==='month'){
      const d=new Date(ms);start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-DAY;
    }else if(calendar.frequency!=='day')throw new Error('Unsupported reporting frequency.');
    return {start:iso(start),end:iso(end),startMs:start,endMs:end,key:iso(start)+'/'+iso(end),sourceDate:String(raw),frequency:calendar.frequency};
  }
  function summaryName(v){return !key(v)||/^(?:agent[ _]name|name|representative|rep|grand total|total|team total|subtotal|summary|average)$/i.test(String(v).trim())||/\b(?:total|subtotal)\s*$/i.test(String(v).trim());}
  function rawKey(row,config){return [config.source,key(row[config.repField]),finite(day(row[config.dateField]))?iso(day(row[config.dateField])):key(row[config.dateField]),key(config.scopeField?row[config.scopeField]:'')].join('|');}
  function mergeRows(previous,incoming,config,meta={}){
    const byKey=new Map(),audit=[],counts={duplicates:0,corrections:0,conflicts:0},seenIncoming=new Map(),conflicts=[],priorConflicts=[];
    for(const r of previous||[]){const k=rawKey(r,config);if(byKey.has(k))priorConflicts.push(r);else byKey.set(k,r);}
    for(const row of incoming||[]){
      const k=rawKey(row,config),old=byKey.get(k),fresh={...row,_dsFile:meta.fileName||row._dsFile||'',_dsImportedAt:meta.importedAt||new Date().toISOString()};
      if(seenIncoming.has(k)){
        const prior=seenIncoming.get(k);
        const same=Object.keys(row).filter(h=>!h.startsWith('_')).every(h=>String(prior[h]??'')===String(row[h]??'')&&prior._dsUnits?.[h]===row._dsUnits?.[h]);
        if(same){counts.duplicates++;continue;}
        conflicts.push(fresh);counts.conflicts++;continue;
      }
      seenIncoming.set(k,row);
      if(old){
        const changed=Object.keys(row).filter(h=>!h.startsWith('_')&&(String(old[h]??'')!==String(row[h]??'')||old._dsUnits?.[h]!==row._dsUnits?.[h]));
        if(!changed.length){counts.duplicates++;continue;}
        counts.corrections++;audit.push({key:k,at:fresh._dsImportedAt,file:fresh._dsFile,previousFile:old._dsFile||'',fields:changed.map(field=>({field,before:old[field]??null,after:row[field]??null}))});
      }
      // A partial import changes only columns actually supplied. Blank cells in a
      // supplied column explicitly replace that measurement with missing data.
      const units={...(old?._dsUnits||{})};for(const field of Object.keys(row).filter(h=>!h.startsWith('_'))){delete units[field];if(row._dsUnits?.[field])units[field]=row._dsUnits[field];}
      byKey.set(k,{...old,...fresh,_dsUnits:units});
    }
    // Importing a different week must not silently resolve an older conflict.
    // A supplied key replaces that key's prior conflicting records only.
    for(const row of priorConflicts){const k=rawKey(row,config);if(seenIncoming.has(k))audit.push({key:k,at:new Date().toISOString(),file:meta.fileName||'',reason:'Prior conflicting observation superseded by imported correction',previous:row});}
    return {rows:[...byKey.values(),...priorConflicts.filter(r=>!seenIncoming.has(rawKey(r,config))),...conflicts],audit,counts};
  }
  function builder(config,options={}){
    const observations=new Map(),totals=[],issues=[],diagnostics={inputRows:0,usableObservations:0,invalidValues:0,unresolvedIdentities:0,invalidDates:0,duplicates:0,conflicts:0,summaryRows:0,missingMappings:[],periods:[],metrics:Object.keys(config.fields||{})};
    if(config.category!=='datedStats')throw new Error('This source is not configured as Dated Stats.');
    for(const h of [config.repField,config.dateField])if(!h||!(options.headers||[]).includes(h))diagnostics.missingMappings.push(h||'Representative / date');
    if(diagnostics.missingMappings.length)throw new Error('Missing Dated Stats mappings: '+diagnostics.missingMappings.join(', '));
    const add=(row,index)=>{
      diagnostics.inputRows++;
      const name=String(row[config.repField]??'').trim();
      if(summaryName(name)){diagnostics.summaryRows++;totals.push({row,index});return;}
      const identity=options.resolveIdentity?options.resolveIdentity(name,row):{id:key(name),name};
      if(!identity?.id){diagnostics.unresolvedIdentities++;issues.push({row:index+2,name,reason:identity?.reason||'Unresolved representative identity'});return;}
      const p=period(row[config.dateField],config.calendar);
      if(!p){diagnostics.invalidDates++;issues.push({row:index+2,name,field:config.dateField,reason:'Invalid source date'});return;}
      const scope=config.scopeField?String(row[config.scopeField]??''):'default';
      const id=[config.source,identity.id,p.key,scope].join('|'),values={};
      const coachResult=options.resolveCoach?.(row[config.coachField])||{value:String(row[config.coachField]??'').trim(),method:'source label'};
      for(const [h,def] of Object.entries(config.fields||{})){const unit=def.inputUnit==='per-date'?def.unitsByDate?.[finite(day(row[config.dateField]))?iso(day(row[config.dateField])):String(row[config.dateField])]:def.inputUnit;values[h]=cell(row[h],{...def,inputUnit:!def.unitReviewed&&row._dsUnits?.[h]||unit});if(['invalid','unavailable'].includes(values[h].status)){diagnostics.invalidValues++;issues.push({row:index+2,name,field:h,reason:values[h].reason||'Unreadable '+h+' value',raw:row[h]});}}
      const o={id,source:config.source,repId:identity.id,rep:identity.name||name,coach:coachResult.value,manager:String(row[config.managerField]??'').trim(),period:p,scope,values,categories:[...new Set(row._dsCategories||[])],provenance:{file:row._dsFile||options.fileName||'',row:row._dsRow||index+2,importedAt:row._dsImportedAt||'',sourceDate:String(row[config.dateField]),method:'imported',rawCoach:row[config.coachField]||'',coachResolution:coachResult.method}};
      const old=observations.get(id);
      if(old){
        if(JSON.stringify(old.values)===JSON.stringify(values)&&key(old.coach)===key(o.coach)){diagnostics.duplicates++;old.categories=[...new Set([...old.categories,...o.categories])];return;}
        diagnostics.conflicts++;old.conflict=true;issues.push({row:index+2,name,reason:'Conflicting measurements or coaches for the same representative, period and scope; resolve the source correction.'});return;
      }
      observations.set(id,o);
    };
    const finish=()=>{
      // Different labels or scopes cannot double-count overlapping intervals.
      const byPerson=new Map();
      for(const o of observations.values()){if(!byPerson.has(o.repId))byPerson.set(o.repId,[]);byPerson.get(o.repId).push(o);}
      for(const rows of byPerson.values()){
        rows.sort((a,b)=>a.period.startMs-b.period.startMs);
        for(let i=1;i<rows.length;i++)if(rows[i].period.startMs<=rows[i-1].period.endMs){rows[i].conflict=rows[i-1].conflict=true;diagnostics.conflicts++;issues.push({name:rows[i].rep,reason:'Overlapping reporting periods/scopes excluded; choose a non-overlapping source scope.'});}
      }
      const all=[...observations.values()];diagnostics.usableObservations=all.filter(o=>!o.conflict&&Object.values(o.values).some(c=>c.status==='valid')).length;
      diagnostics.periods=[...new Set(all.map(o=>o.period.key))].sort();
      return {version:VERSION,config:copy(config),observations:all,totals,issues,diagnostics,builtAt:new Date().toISOString()};
    };
    return {add,finish};
  }
  function categorize(rows,config,options={}){const b=builder(config,options);rows.forEach(b.add);return b.finish();}
  async function categorizeAsync(rows,config,options={}){
    const b=builder(config,options);
    for(let i=0;i<rows.length;i++){if(options.cancelled?.())throw Object.assign(new Error('Dated Stats categorization cancelled.'),{name:'AbortError'});b.add(rows[i],i);if(i%500===0){options.progress?.(i,rows.length);await (options.yield?.()||Promise.resolve());}}
    return b.finish();
  }
  function standardMetrics(source){
    const rate=(id,name,numerator,denominator)=>({id, name,kind:'percentage',numerator,denominator});
    return [rate('consumer_share','Cash / Consumer Opportunity Share','Consumer Opportunities',['Consumer Opportunities','Insurance Opportunities','Commercial Opportunities']),rate('consumer_ar','Cash / Consumer Appointment Rate','Consumer Appointments','Consumer Opportunities'),rate('total_ar','Total Appointment Rate','Total Appointments','Total Opportunities'),rate('insurance_ar','Insurance Appointment Rate','Insurance Appointments','Insurance Opportunities'),rate('wiper_rate','Wiper Rate',source==='weeklyRetail'?'Wiper Count':'Wipers Accept',source==='weeklyRetail'?'Wiper Jobs':'Wipers Asked')];
  }
  function normalizeMetric(metric={}){
    const m={...metric,definitionVersion:VERSION,dataCategory:'datedStats',mode:'datedStats',source:metric.source||'weeklyRetail',field:metric.field||'',statistic:metric.statistic||'',aggregation:metric.aggregation||'equal_rep',output:metric.output||'value',minDenominator:Math.max(0,Number(metric.minDenominator)||0),minValidPeriods:Math.max(1,Math.floor(Number(metric.minValidPeriods)||1)),lastPeriods:Math.max(0,Math.floor(Number(metric.lastPeriods)||0)),startDate:metric.startDate||'',endDate:metric.endDate||'',missingPolicy:'exclude',periodField:'resolved-period'};
    const standard=standardMetrics(m.source).find(s=>s.id===m.statistic);
    if(standard)Object.assign(m,{kind:standard.kind,numerator:standard.numerator,denominator:standard.denominator,formulaLabel:standard.name});
    if(m.startDate&&!finite(day(m.startDate))||m.endDate&&!finite(day(m.endDate))||m.startDate&&m.endDate&&m.startDate>m.endDate)throw new Error('Choose valid ordered reporting dates.');
    m.kind=m.kind||'number';m.behavior=m.behavior|| (m.kind==='count'?'activity':m.kind==='percentage'?'rate':'average');
    if(!['equal_rep','combined_rate','sum','min','max','first','latest'].includes(m.aggregation))throw new Error('Choose a supported numerical calculation.');
    if(m.aggregation==='sum'&&(m.kind==='percentage'||m.behavior!=='activity'))throw new Error('Totals are available only for separate activity measurements; percentages, snapshots and cumulative values cannot be summed.');
    if(m.aggregation==='combined_rate'&&(!m.numerator||!m.denominator))throw new Error('Combined rate requires validated numerator and denominator fields.');
    if(m.kind==='percentage'&&m.expression&&!m.numerator)throw new Error('Define a rate with numerator and denominator fields.');
    return m;
  }
  function formula(expression,values){
    // Arithmetic only, no eval, property access or cross-source joins.
    const tokens=String(expression||'').match(/\[[^\]]+\]|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/]|\S/g)||[];let i=0;
    const atom=()=>{const t=tokens[i++];if(t==='-')return -atom();if(t==='+')return atom();if(t==='('){const v=expr();if(tokens[i++]!==')')throw new Error('Missing closing parenthesis.');return v;}if(/^\[.+\]$/.test(t||'')){const c=values[t.slice(1,-1)];if(!c)throw new Error('Unmapped field '+t+'. Expressions must use fields from the same source and period.');return c.status==='valid'?c.value:NaN;}if(t&&/^\d*\.?\d+$/.test(t))return Number(t);throw new Error('Use [field] references and arithmetic within one representative-period.');};
    const product=()=>{let v=atom();while(['*','/'].includes(tokens[i])){const op=tokens[i++],n=atom();v=op==='*'?v*n:n===0?NaN:v/n;}return v;};
    const expr=()=>{let v=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],n=product();v=op==='+'?v+n:v-n;}return v;};
    const value=expr();if(i!==tokens.length)throw new Error('Incompatible expression; cross-source or undated inputs are not numerical observations.');return Number.isFinite(value)?value:null;
  }
  function measure(o,m){
    if(o.conflict)return {value:null,status:'conflict',reason:'Conflicting or overlapping observations'};
    const fields=field=>Array.isArray(field)?field:[field];
    const component=field=>{const cs=fields(field).map(f=>o.values[f]);return cs.every(c=>c?.status==='valid')?sum(cs.map(c=>c.value)):null;};
    if(m.numerator&&m.denominator){
      const n=component(m.numerator),d=component(m.denominator);
      if(n==null||d==null)return {value:null,status:'missing',reason:'Missing/invalid rate components',numerator:n,denominator:d};
      if(d<=0||n<0||n>d||d<m.minDenominator)return {value:null,status:'unavailable',reason:d<=0?'Zero or invalid denominator':d<m.minDenominator?'Below minimum denominator':'Invalid rate components',numerator:n,denominator:d};
      return {value:n/d*100,status:'valid',numerator:n,denominator:d,method:'calculated'};
    }
    if(m.minDenominator>0)return {value:null,status:'unavailable',reason:'Minimum opportunities requires a mapped denominator'};
    if(m.expression){const value=formula(m.expression,o.values);return {value,status:value==null?'missing':'valid',reason:value==null?'Missing expression input or zero divisor':'',method:'calculated'};}
    const c=o.values[m.field];return c?{...c,reason:c.status==='valid'?'':c.reason||c.status+' measurement'}:{value:null,status:'unavailable',reason:'Field not mapped for this source'};
  }
  function within(p,start,end){return (!start||p.start>=start)&&(!end||p.end<=end);}
  function selected(observations,m){
    let rows=observations.filter(o=>o.source===m.source&&within(o.period,m.startDate,m.endDate));
    if(m.lastPeriods&&m.periodSelection==='valid'){const people=new Map();for(const o of rows){if(!people.has(o.repId))people.set(o.repId,[]);if(measure(o,m).status==='valid')people.get(o.repId).push(o);}rows=[...people.values()].flatMap(values=>{const periods=new Set([...new Set(values.map(o=>o.period.key))].sort().slice(-m.lastPeriods));return values.filter(o=>periods.has(o.period.key));});}
    else if(m.lastPeriods&&rows.length){
      const latest=rows.reduce((a,b)=>a.period.startMs>b.period.startMs?a:b).period;
      const d=new Date(latest.startMs),begin=latest.frequency==='month'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-m.lastPeriods+1,1):latest.startMs-(m.lastPeriods-1)*(latest.frequency==='day'?DAY:WEEK);
      rows=rows.filter(o=>o.period.startMs>=begin);
    }
    return [...new Map(rows.map(o=>[o.id,o])).values()];
  }
  function aggregate(observations,metric,expectedIds){
    const m=normalizeMetric(metric),rows=selected(observations,m),byRep=new Map();
    for(const o of rows){if(!byRep.has(o.repId))byRep.set(o.repId,[]);byRep.get(o.repId).push({...measure(o,m),repId:o.repId,rep:o.rep,coach:o.coach,period:o.period,observationId:o.id,provenance:o.provenance});}
    const eligible=[],excluded=[],repValues=[];
    for(const [id,values] of byRep){
      const valid=values.filter(v=>v.status==='valid').sort((a,b)=>a.period.startMs-b.period.startMs),periods=new Set(valid.map(v=>v.period.key));
      excluded.push(...values.filter(v=>v.status!=='valid'));
      if(periods.size<m.minValidPeriods){excluded.push({repId:id,rep:values[0].rep,status:'insufficient',reason:`Requires ${m.minValidPeriods} valid periods; found ${periods.size}`});continue;}
      eligible.push(...valid);repValues.push({repId:id,rep:values[0].rep,value:mean(valid.map(v=>v.value))});
    }
    const expected=new Set(expectedIds||byRep.keys()),validIds=new Set(eligible.map(v=>v.repId));
    for(const id of expected)if(!byRep.has(id))excluded.push({repId:id,status:'missing',reason:'No observation in the selected complete period'});
    let value=null,numerator=null,denominator=null;
    if(eligible.length){
      if(m.aggregation==='combined_rate'){numerator=sum(eligible.map(v=>v.numerator));denominator=sum(eligible.map(v=>v.denominator));value=denominator>0?100*numerator/denominator:null;}
      else if(m.aggregation==='equal_rep')value=mean(repValues.map(v=>v.value));
      else if(m.aggregation==='sum')value=sum(eligible.map(v=>v.value));
      else if(m.aggregation==='min'||m.aggregation==='max')value=eligible.reduce((v,c)=>m.aggregation==='min'?Math.min(v,c.value):Math.max(v,c.value),eligible[0].value);
      else{const dates=eligible.map(v=>v.period.start).sort(),date=m.aggregation==='first'?dates[0]:dates[dates.length-1];value=mean(eligible.filter(v=>v.period.start===date).map(v=>v.value));}
    }
    return {value,numerator,denominator,eligibleRepresentatives:validIds.size,missingRepresentatives:[...expected].filter(id=>!validIds.has(id)).length,validPeriods:new Set(eligible.map(v=>v.period.key)).size,representatives:repValues,contributions:eligible,exclusions:excluded,aggregation:m.aggregation,unit:m.kind==='percentage'?'%':m.kind==='duration'?'seconds':m.kind,metric:m};
  }
  function series(observations,metric,expectedIds){
    const m=normalizeMetric(metric),rows=selected(observations,m),periods=new Map(rows.map(o=>[o.period.key,o.period]));
    const starts=[...periods.values()].sort((a,b)=>a.startMs-b.startMs);
    if(starts.length&&starts[0].frequency==='week'){
      const requested=m.startDate?day(m.startDate):m.lastPeriods&&m.periodSelection!=='valid'?starts[starts.length-1].startMs-(m.lastPeriods-1)*WEEK:starts[0].startMs, begin=starts[0].startMs+Math.ceil((requested-starts[0].startMs)/WEEK)*WEEK, end=m.endDate?day(m.endDate)-6*DAY:starts[starts.length-1].startMs;
      for(let ms=begin;ms<=end;ms+=WEEK){const p={start:iso(ms),end:iso(ms+6*DAY),startMs:ms,endMs:ms+6*DAY,frequency:'week',key:iso(ms)+'/'+iso(ms+6*DAY)};if(!periods.has(p.key))periods.set(p.key,p);}
    }
    const counts=new Map();for(const o of rows)if(measure(o,m).status==='valid'){if(!counts.has(o.repId))counts.set(o.repId,new Set());counts.get(o.repId).add(o.period.key);}const eligibleIds=new Set([...counts].filter(([,p])=>p.size>=m.minValidPeriods).map(([id])=>id));
    const expected=expectedIds||[...new Set(rows.map(o=>o.repId))];
    const grouped=new Map();for(const o of rows.filter(o=>eligibleIds.has(o.repId))){if(!grouped.has(o.period.key))grouped.set(o.period.key,[]);grouped.get(o.period.key).push(o);}
    return [...periods.values()].sort((a,b)=>a.startMs-b.startMs).map(p=>{
      const result=aggregate(grouped.get(p.key)||[],{...m,minValidPeriods:1,lastPeriods:0,startDate:'',endDate:''},expected);
      result.exclusions=result.exclusions.map(e=>!eligibleIds.has(e.repId)&&counts.has(e.repId)?{...e,status:'insufficient',reason:`Requires ${m.minValidPeriods} valid periods; found ${counts.get(e.repId).size}`}:e);
      return {period:p,...result};
    });
  }
  function trend(points,minPeriods=2){
    const valid=points.filter(p=>finite(p.value)),values=valid.map(p=>p.value),count=valid.length;
    const result={average:mean(values),first:values[0]??null,latest:values[count-1]??null,validPeriods:count,change:null,relativeChange:null,slope:null};
    if(count<Math.max(2,minPeriods))return result;
    result.change=result.latest-result.first;result.relativeChange=result.first===0?null:100*result.change/Math.abs(result.first);
    const t0=valid[0].period.startMs,xs=valid.map(p=>(p.period.startMs-t0)/WEEK),mx=mean(xs),my=result.average;
    const denominator=sum(xs.map(x=>(x-mx)**2));result.slope=denominator?sum(xs.map((x,i)=>(x-mx)*(values[i]-my)))/denominator:null;return result;
  }

  function profileUnits(rows,config){
    const result={};
    for(const [field,def] of Object.entries(config.fields||{})){
      if(def.kind!=='percentage')continue;
      const dates=new Map();let fraction=0,points=0;
      for(const row of rows){const raw=String(row[field]??'').trim();if(!raw||raw.endsWith('%'))continue;const n=Number(raw);if(!Number.isFinite(n)||n<0)continue;const ms=day(row[config.dateField]);if(!finite(ms))continue;const date=iso(ms);if(!dates.has(date))dates.set(date,{date,lessThanOne:0,aboveOne:0,zerosOrOnes:0,min:n,max:n});const d=dates.get(date);d.min=Math.min(d.min,n);d.max=Math.max(d.max,n);if(n>0&&n<1){d.lessThanOne++;fraction++;}else if(n>1){d.aboveOne++;points++;}else d.zerosOrOnes++;}
      if(fraction&&points)result[field]={fraction,points,dates:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))};
    }
    return result;
  }
  function metricResult(observations,metric,context={}){
    const m=normalizeMetric(metric);
    if(m.output==='series'){
      if(context.scalar)throw new Error('This metric returns a series. Select a Trend summary or a per-period rule before comparing it with a scalar.');
      return {points:series(observations,m),value:null,output:'series'};
    }
    if(m.output==='summary'){
      const points=series(observations,m),summary=trend(points,m.minValidPeriods),value=summary[m.summary||'change'];
      return {value,points,summary,output:'summary',unit:resultUnit(m,m.summary||'change')};
    }
    return aggregate(observations,m,context.expectedIds);
  }

  function compare(value,operator,a,b){if(!finite(value)||!Number.isFinite(Number(a)))return false;const n=Number(a),n2=Number(b);return ({eq:()=>value===n,gt:()=>value>n,gte:()=>value>=n,lt:()=>value<n,lte:()=>value<=n,between:()=>Number.isFinite(n2)&&value>=Math.min(n,n2)&&value<=Math.max(n,n2)})[operator||'gte']?.()||false;}
  function criterion(observations,metric,rule={}){
    if(rule.mode==='comparison_change'&&(!rule.baselineStart||!rule.baselineEnd||!rule.comparisonStart||!rule.comparisonEnd||rule.baselineEnd>=rule.comparisonStart))throw new Error('Choose distinct ordered baseline and comparison periods.');
    const m=normalizeMetric({...metric,startDate:rule.startDate||metric.startDate,endDate:rule.endDate||metric.endDate,lastPeriods:rule.lastPeriods||metric.lastPeriods}),points=series(observations,m),summary=trend(points,rule.minPeriods||m.minValidPeriods);
    let value;
    if(rule.mode==='qualifying_periods')value=points.filter(p=>compare(p.value,rule.operator,rule.threshold,rule.threshold2)).length;
    else if(rule.mode==='comparison_change'){
      const baseline=aggregate(observations,{...m,startDate:rule.baselineStart,endDate:rule.baselineEnd,lastPeriods:0}).value,after=aggregate(observations,{...m,startDate:rule.comparisonStart,endDate:rule.comparisonEnd,lastPeriods:0}).value;
      value=finite(baseline)&&finite(after)?after-baseline:null;
    }else if(rule.mode==='trend')value=summary[rule.summary||'change'];
    else value=metricResult(observations,m,{scalar:true}).value;
    if(summary.validPeriods<Math.max(1,Number(rule.minPeriods||m.minValidPeriods)))value=null;
    const pass=rule.mode==='qualifying_periods'?finite(value)&&value>=Number(rule.requiredPeriods||1):compare(value,rule.operator,rule.threshold,rule.threshold2);
    const unit=rule.mode==='qualifying_periods'?'periods':resultUnit(m,rule.mode==='comparison_change'?'change':rule.mode==='trend'?rule.summary||'change':m.output==='summary'?m.summary||'change':'');
    return {value,pass,points,trend:summary,unit};
  }
  function dedupeEvents(events){
    const map=new Map();
    for(const event of events){
      if(!event.repId||!finite(day(event.date)))continue;
      const id=event.id?`${event.source}|${event.repId}|${event.id}`:[event.source,event.repId,event.date,event.deliveredBy||'',event.text||''].join('|');
      if(!map.has(id))map.set(id,{...event,id,date:iso(day(event.date)),topics:[...new Set(event.topics||[])]});
      else {
        const existing=map.get(id);
        existing.variants=existing.variants||[{fields:existing.fields,text:existing.text,topics:existing.topics}];
        existing.variants.push(...(event.variants||[{fields:event.fields,text:event.text,topics:event.topics}]));
        existing.topics=[...new Set([...existing.topics,...(event.topics||[])])];
      }
    }
    return [...map.values()];
  }
  function eventSummary(events,repId,window,coverage={},condition={}){
    const matches=e=>(!condition.topic||key([e.text,...(e.topics||[])].join(' ')).includes(key(condition.topic)))&&(!condition.field||!condition.value||(condition.match==='is'?key(e.fields?.[condition.field])===key(condition.value):key(e.fields?.[condition.field]).includes(key(condition.value))));
    const matching=events.filter(e=>e.repId===repId&&(!condition.source||e.source===condition.source)&&e.date>=window.start&&e.date<=window.end&&(e.variants||[e]).some(matches));
    const covered=coverage.complete===true&&coverage.start<=window.start&&coverage.end>=window.end&&(!coverage.repIds||coverage.repIds.includes(repId));
    // Observed sessions remain evidence, but an exact frequency (including zero)
    // needs reviewed coverage of the entire window and population.
    return {count:covered?matching.length:null,observedCount:matching.length,events:matching,covered};
  }
  function eventConditionPass(summary,condition={}){
    const operator=condition.operator||'gte',threshold=condition.threshold??1;
    if(summary.covered)return compare(summary.count,operator,threshold,condition.threshold2);
    // Observed sessions prove a lower bound even when coverage is incomplete.
    // Exact counts, upper bounds and zero-session groups still need coverage.
    return summary.observedCount>0&&['gte','gt'].includes(operator)&&compare(summary.observedCount,operator,threshold);
  }
  const bucket=(n,buckets=[0,1,2,3,4])=>n==null?'Unknown coaching coverage':`${buckets.filter(b=>n>=b).slice(-1)[0]??0}${n>=buckets[buckets.length-1]?'+':''} sessions`;
  function researchSetup(observations,metric,settings={},events=[]){
    const m=normalizeMetric(metric);if(!observations.length)throw new Error('Categorize this Dated Stats source first.');
    const available=observations.filter(o=>o.source===m.source), config={mode:'fixed',groupBy:'all',buckets:[0,1,2,3,4],...settings};
    if(config.mode==='before_after'&&available.some(o=>o.period.frequency!=='week'))throw new Error('Before/after weekly alignment requires a weekly source.');
    const allEvents=dedupeEvents(events),rows=available.filter(o=>(!config.repIds||config.repIds.includes(o.repId))&&(!config.coaches?.length||config.coaches.map(key).includes(key(o.coach)))&&(!config.managers?.length||config.managers.map(key).includes(key(o.manager))));
    const activity=['coaching_count','coaching_per_rep','coached_percent'].includes(config.measure);
    const eventsByRep=new Map(),summaryCache=new Map();
    for(const event of allEvents){if(!eventsByRep.has(event.repId))eventsByRep.set(event.repId,[]);eventsByRep.get(event.repId).push(event);}
    const summary=(id,window,condition)=>{
      const cacheKey=JSON.stringify([id,window,condition]);
      if(!summaryCache.has(cacheKey))summaryCache.set(cacheKey,eventSummary(eventsByRep.get(id)||[],id,window,coverageFor(condition.source),condition));
      return summaryCache.get(cacheKey);
    };
    const coachingCondition={source:config.coachingSource||'documented_coaching',topic:config.topic,field:config.coachingField,value:config.coachingValue,match:config.coachingMatch};
    const byRep=new Map();for(const o of available){if(!byRep.has(o.repId))byRep.set(o.repId,[]);byRep.get(o.repId).push(o);}for(const history of byRep.values())history.sort((a,b)=>a.period.startMs-b.period.startMs);const ids=[...new Set(rows.map(o=>o.repId))];
    const anchor={start:config.anchorStart||m.startDate,end:config.anchorEnd||m.endDate};
    if((config.eventConditions?.length||config.groupBy==='coaching_frequency'||config.mode==='before_after')&&config.mode!=='changing'&&(!anchor.start||!anchor.end))throw new Error('Choose an explicit anchor/coaching window.');
    const coverageFor=source=>config.coverage?.[source]||config.coverage||{};
    const qualifies=(id,window)=>{
      for(const condition of config.eventConditions||[]){const w=condition.startDate&&condition.endDate?{start:condition.startDate,end:condition.endDate}:window,s=summary(id,w,condition);if(!eventConditionPass(s,condition))return false;}
      for(const condition of config.statConditions||[]){const def=condition.metric;if(!def)throw new Error('A population condition references a missing metric.');const rule={...condition,startDate:condition.startDate||window.start,endDate:condition.endDate||window.end};if(!criterion(byRep.get(id)||[],def,rule).pass)return false;}
      return true;
    };
    const inScope=o=>(!config.coaches?.length||config.coaches.map(key).includes(key(o.coach)))&&(!config.managers?.length||config.managers.map(key).includes(key(o.manager)));
    const fixed=ids.filter(id=>{const history=byRep.get(id)||[],atAnchor=anchor.end?history.filter(o=>o.period.start<=anchor.end).sort((a,b)=>b.period.start.localeCompare(a.period.start))[0]:history[history.length-1];return (!atAnchor||inScope(atAnchor))&&qualifies(id,anchor);}),anchors=new Map();
    if(config.mode==='before_after')for(const id of fixed){const hits=allEvents.filter(e=>e.repId===id&&e.source===(config.coachingSource||'documented_coaching')&&e.date>=anchor.start&&e.date<=anchor.end&&(!config.topic||key([e.text,...e.topics].join(' ')).includes(key(config.topic)))).sort((a,b)=>a.date.localeCompare(b.date));if(hits.length){const p=available.find(o=>o.period.start<=hits[0].date&&o.period.end>=hits[0].date)?.period;if(p)anchors.set(id,p);}}
    const pts=series(available,m), periods=pts.map(p=>p.period);
    const eligibility=new Map();for(const o of (config.mode==='before_after'?rows:selected(rows,m)))if(measure(o,m).status==='valid'){if(!eligibility.has(o.repId))eligibility.set(o.repId,new Set());eligibility.get(o.repId).add(o.period.key);}
    const labels=config.mode==='before_after'?Array.from({length:Number(config.beforeWeeks??4)+Number(config.afterWeeks??6)+1},(_,i)=>i-Number(config.beforeWeeks??4)):periods;
    const frequencyWindow=(p)=>config.frequencyWindow==='fixed'?anchor:config.frequencyWindow==='rolling'?{start:iso(p.startMs-(Math.max(1,Number(config.rollingWeeks)||4)-1)*WEEK),end:p.end}:config.frequencyWindow==='anchor'?anchor:p;
    const lineFor=(id,o,p)=>{
      if(config.groupBy==='coaching_frequency'){const w=frequencyWindow(p),s=summary(id,w,coachingCondition);return [config.exactBuckets&&s.count!=null?`${s.count} session${s.count===1?'':'s'}`:bucket(s.count,config.buckets)];}
      if(config.groupBy==='representative')return [o.rep];
      if(config.groupBy==='coach')return [o.coach||'Unknown assigned coach'];
      if(config.groupBy==='manager')return [o.manager||'Unknown manager'];
      if(config.groupBy==='organization')return (config.organizations||[]).filter(org=>org.coaches.map(key).includes(key(o.coach))).map(org=>org.name);
      return ['All eligible loaded representatives'];
    };
    const compute=label=>{
      const dynamic=config.mode==='changing',members=dynamic?ids.filter(id=>{const current=(byRep.get(id)||[]).find(o=>o.period.key===label.key);return (!current||inScope(current))&&qualifies(id,label);}):fixed,groups=new Map();
      for(const id of members){
        if(config.mode==='before_after'&&!anchors.has(id))continue;
        const p=config.mode==='before_after'?(()=>{const a=anchors.get(id),startMs=a.startMs+label*WEEK;return {start:iso(startMs),end:iso(startMs+6*DAY),startMs,endMs:startMs+6*DAY,key:iso(startMs)+'/'+iso(startMs+6*DAY)};})():label;
        const history=byRep.get(id)||[],observed=history.find(o=>o.period.key===p.key),o=observed&&inScope(observed)?observed:null,scopedHistory=history.filter(inScope),last=scopedHistory.filter(o=>o.period.start<=p.start).slice(-1)[0],context=o||last||scopedHistory[0];
        if(!context)continue;
        const lines=lineFor(id,context,p);
        for(const line of lines){
          if(!groups.has(line))groups.set(line,{ids:[],observations:[],excluded:new Map()});const g=groups.get(line);g.ids.push(id);
          const validPeriods=eligibility.get(id)?.size||0;
          if(observed&&!o)g.excluded.set(id,{status:'excluded',reason:'Assigned coach or manager is outside the selected population for this period'});
          else if(!activity&&validPeriods<m.minValidPeriods)g.excluded.set(id,{status:'insufficient',reason:`Requires ${m.minValidPeriods} valid periods; found ${validPeriods}`});
          else if(o)g.observations.push(o);
          if(activity){
            if(!g.activity)g.activity=[];
            const w=config.activityWindow==='trailing_week'?{start:iso(p.endMs-6*DAY),end:p.end}:p,s=summary(id,w,coachingCondition);
            g.activity.push({repId:id,rep:context.rep,coach:context.coach,period:p,value:s.count,numerator:s.count,denominator:1,status:s.covered&&o?'valid':'missing',reason:!o?'No population observation for this period':!s.covered?'Coaching coverage is not confirmed for this person and window':'',events:s.events.map(e=>({id:e.id,date:e.date,text:e.text})),observedCount:s.observedCount});
          }
        }
      }
      return [...groups].map(([line,g])=>{
        let result;
        if(activity){
          const valid=(g.activity||[]).filter(v=>v.status==='valid'),excluded=(g.activity||[]).filter(v=>v.status!=='valid'),total=sum(valid.map(v=>v.value)),coached=valid.filter(v=>v.value>0).length;
          result={value:valid.length?(config.measure==='coaching_count'?total:config.measure==='coached_percent'?100*coached/valid.length:total/valid.length):null,numerator:config.measure==='coached_percent'?coached:total,denominator:valid.length,eligibleRepresentatives:valid.length,missingRepresentatives:excluded.length,contributions:valid,exclusions:excluded,representatives:valid.map(v=>({repId:v.repId,rep:v.rep,value:v.value})),aggregation:config.measure,unit:config.measure==='coached_percent'?'%':config.measure==='coaching_per_rep'?'sessions / rep':'sessions'};
        }else result=aggregate(g.observations,{...m,startDate:'',endDate:'',lastPeriods:0,minValidPeriods:1},g.ids);
        result.exclusions=result.exclusions.map(e=>g.excluded.has(e.repId)?{...e,...g.excluded.get(e.repId)}:e);return {line,label:typeof label==='number'?(label===0?'Coaching week (mixed timing)':`Week ${label>0?'+':''}${label}`):label.start,relativeWeek:typeof label==='number'?label:null,period:typeof label==='number'?null:label,...result,members:g.ids};});
    };
    return {labels,compute,definition:{metric:m,settings:copy(config)},description:`${m.name||m.formulaLabel||m.field} · ${config.mode==='changing'?'Membership recalculated each week':config.mode==='before_after'?'First qualifying session; coaching week has mixed timing; Week +1 is the first complete subsequent week':'Fixed qualifying group'} · ${config.groupBy} · ${m.aggregation==='equal_rep'?'Equal-representative average':m.aggregation} · Loaded eligible representatives only`,warnings:['Observed performance comparison; does not establish that coaching caused a change.',...(config.currentMembership?['Organization/manager selection uses current saved membership; point coaches come from historical observations.']:[])]};
  }
  async function research(observations,metric,settings,events,options={}){
    if(options.cancelled?.())throw Object.assign(new Error('Research cancelled.'),{name:'AbortError'});
    await (options.yield?.()||Promise.resolve());
    const setup=researchSetup(observations,metric,settings,events),data=[];
    for(let i=0;i<setup.labels.length;i++){if(options.cancelled?.())throw Object.assign(new Error('Dated Stats research cancelled.'),{name:'AbortError'});data.push(...setup.compute(setup.labels[i]));options.progress?.(i+1,setup.labels.length);await (options.yield?.()||Promise.resolve());}
    const {compute,labels,...meta}=setup;
    const axisLabels=labels.map(label=>typeof label==='number'?(label===0?'Coaching week (mixed timing)':`Week ${label>0?'+':''}${label}`):label.start);
    const result={...meta,version:VERSION,data,axisLabels,calculatedAt:new Date().toISOString(),columns:[{label:metric.name||metric.field,mode:'datedStats'}]};
    if(settings?.measure&&settings.measure!=='performance'){
      result.measureLabel=({coaching_count:'Documented coaching sessions',coaching_per_rep:'Average documented coachings per representative',coached_percent:'Percentage of representatives coached'}[settings.measure]||settings.measure);
      result.columns=[{label:result.measureLabel,mode:'datedStats'}];
      result.description=result.measureLabel+' · '+settings.groupBy+' · '+(settings.activityWindow==='trailing_week'?'7 days ending at each reporting date':'Each reporting period')+' · Only representatives with confirmed event coverage and a population observation; covered zeros included';
      result.warnings=result.warnings.filter(w=>!w.startsWith('Observed performance comparison'));
    }
    result.movement=researchMovement(result,metric);
    return result;
  }
  function researchMovement(result,metric){
    const m=normalizeMetric(metric),first=result.axisLabels?.[0],last=result.axisLabels?.at(-1),out=[];
    for(const line of new Set(result.data.map(p=>p.line))){
      const start=result.data.find(p=>p.line===line&&p.label===first),end=result.data.find(p=>p.line===line&&p.label===last),endIds=new Set((end?.contributions||[]).map(v=>v.repId));
      const paired=new Set((start?.contributions||[]).filter(v=>endIds.has(v.repId)).map(v=>v.repId));
      const value=p=>{
        const rows=(p?.contributions||[]).filter(v=>paired.has(v.repId));if(!rows.length)return null;
        if(p.aggregation==='coached_percent')return 100*rows.filter(v=>v.value>0).length/rows.length;
        if(p.aggregation==='combined_rate'){const denominator=sum(rows.map(v=>v.denominator));return denominator?100*sum(rows.map(v=>v.numerator))/denominator:null;}
        if(p.aggregation==='sum'||p.aggregation==='coaching_count')return sum(rows.map(v=>v.value));
        if(p.aggregation==='min')return Math.min(...rows.map(v=>v.value));if(p.aggregation==='max')return Math.max(...rows.map(v=>v.value));
        return mean(rows.map(v=>v.value));
      };
      const a=value(start),b=value(end),comparable=first!==last&&a!=null&&b!=null;
      out.push({line,firstPeriod:first,lastPeriod:last,first:comparable?a:null,latest:comparable?b:null,change:comparable?b-a:null,pairedRepresentatives:comparable?paired.size:0,unit:start?.unit||end?.unit||resultUnit(m),changeUnit:(start?.unit||end?.unit)==='%'?'percentage points':start?.unit||end?.unit||resultUnit(m,'change')});
    }
    return out;
  }
  const api={profileUnits,metricResult,VERSION,SOURCES,DAY,WEEK,key,day,iso,cell,defaultConfig,period,summaryName,mergeRows,categorize,categorizeAsync,standardMetrics,normalizeMetric,formula,measure,aggregate,series,trend,criterion,compare,dedupeEvents,eventSummary,eventConditionPass,research};
  root.AllStarDatedStats=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
