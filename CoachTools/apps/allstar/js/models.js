/* Model normalization, aliases, data indexes, Model Builder, and source requirements.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

function sourceDefaults(source){return clonePlain(SOURCE_SETTING_DEFAULTS[source]||{headerRow:1,startCol:1});}
function normalizeSourceSettings(settings){
  const out={};
  [...Object.keys(SOURCE_SETTING_DEFAULTS), ...customSourceKeys()].forEach(src=>{
    const base=isCustomSource(src)?customSourceDefaultSettings(src):sourceDefaults(src), cur=(settings&&settings[src])||{};
    out[src]={...base,...cur,columns:{...(base.columns||{}),...(cur.columns||{})}};
    out[src].headerRow=Math.max(1,Number(out[src].headerRow)||base.headerRow||1);
    out[src].startCol=Math.max(1,Number(out[src].startCol)||base.startCol||1);
  });
  return out;
}
function ensureSourceSettings(model){
  if(!model) return normalizeSourceSettings({});
  model.sourceSettings=normalizeSourceSettings(model.sourceSettings);
  return model.sourceSettings;
}
function getSourceSetting(model, source){
  const settings=ensureSourceSettings(model||{});
  return settings[source] || sourceDefaults(source);
}
function plainHeaderName(v){
  if(v===null||v===undefined) return '';
  if(Array.isArray(v)) return plainHeaderName(v[0]);
  if(typeof v==='object') v=String(v.name ?? v.header ?? v.value ?? v.label ?? '').trim();
  const s=String(v).trim();
  const simpleBracket=s.match(/^\[\s*([^\]]+?)\s*\]$/);
  return simpleBracket ? simpleBracket[1].trim() : s;
}
function bracketedHeaderSuggestion(h){
  const name=plainHeaderName(h);
  return name ? `[${name}]` : '';
}
function validSourceKey(source, fallback='retail_sv2'){
  return allSourceKeys().includes(source) ? source : fallback;
}
function normalizeCriterionForStorage(c){
  const original=c||{}, hadLookupSettings=Number(original.lookupVersion)>=2||!!plainHeaderName(original.lookupMatchColumn)||original.audience==='coach';
  c = {...original};
  c.id=c.id||id();
  c.name=String(c.name||'New Criteria').trim();
  c.source=validSourceKey(c.source,'retail_sv2');
  // Preserve imported secondary/custom source selections when present, but safely
  // default old model exports to the primary Source. The editor still auto-links
  // these selectors when the primary source changes via setCriterionPrimarySource().
  c.leftSource=validSourceKey(c.leftSource,c.source);
  c.rightSource=validSourceKey(c.rightSource,c.source);
  c.customSource=validSourceKey(c.customSource,c.source);
  c.audience=['both','team','rep','coach'].includes(c.audience)?c.audience:'both';
  c.scoreType=['rank','points','display'].includes(c.scoreType)?c.scoreType:'rank';
  c.direction=['higher','lower'].includes(c.direction)?c.direction:'higher';
  c.weight=String(c.weight||'1')==='autofail'?'autofail':String(Number(c.weight)||1);
  c.format=['number','pct'].includes(c.format)?c.format:'number';
  c.trueValueEnabled=!!c.trueValueEnabled;
  c.trueValueSource=TEAM_TOTAL_SOURCE_KEYS.includes(c.trueValueSource)?c.trueValueSource:'';
  c.trueValueColumn=String(c.trueValueColumn||'').trim();
  c.calcType=['single','multi','custom','qaScore','checklistCount','displayColumn'].includes(c.calcType)?c.calcType:'single';
  if(c.calcType==='displayColumn'){
    c.scoreType='display';
    c.trueValueEnabled=false;
    if(c.audience==='both') c.audience='rep';
    c.lookupVersion=hadLookupSettings||Number(c.lookupVersion)>=2?2:1;
    c.displayMode=['lookup','calculated'].includes(c.displayMode)?c.displayMode:'lookup';
    c.lookupMatchEntity=['representative','coach','team','custom'].includes(c.lookupMatchEntity)?c.lookupMatchEntity:(c.audience==='rep'?'representative':c.audience==='coach'?'coach':'team');
    c.lookupMatchColumn=plainHeaderName(c.lookupMatchColumn||'');
    c.lookupReturnColumn=plainHeaderName(c.lookupReturnColumn||c.column||'');
    c.lookupDateColumn=plainHeaderName(c.lookupDateColumn||'');
    c.lookupCustomValue=String(c.lookupCustomValue||'').trim();
    c.lookupSelection=['latest','earliest','first','last','mostCommon','highest','lowest','joinUnique'].includes(c.lookupSelection)?c.lookupSelection:'latest';
    c.displayCalculation=['raw','count','daysSince','monthsSince','yearsSince'].includes(c.displayCalculation)?c.displayCalculation:'raw';
    c.displayValueType=['auto','number','percent','date','text'].includes(c.displayValueType)?c.displayValueType:'auto';
    c.displayMissingMode=['blank','na','notFound','zero','custom'].includes(c.displayMissingMode)?c.displayMissingMode:'blank';
    c.displayMissingText=String(c.displayMissingText||'').trim();
    c.displayRules=(Array.isArray(c.displayRules)?c.displayRules:[]).map(rule=>normalizeDisplayRule(rule));
  }
  c.aggregate=['sum','avg','count','latest','first','max','min','uniqueWeeks','uniqueReps','percent','avgWeeklyPercent','weightedPercent','dateWithin','dateWithinPercent','valueWithin','valueWithinPercent'].includes(c.aggregate)?c.aggregate:'sum';
  c.operator=['divide','multiply','plus','minus','greaterThan','lessThan'].includes(c.operator)?c.operator:'divide';
  c.qaColumns={...(c.qaColumns||{})};
  c.checkValueType=['text','number'].includes(c.checkValueType)?c.checkValueType:'text';
  c.checkOperator=normalizeRowPullOperator(c.checkOperator,c.checkValueType);
  if(c.missingRank===undefined || c.missingRank===null || c.missingRank==='') c.missingRank=999;
  if(c.missingPoints===undefined || c.missingPoints===null || c.missingPoints==='') c.missingPoints=0;
  if(c.minimumMonitors===undefined || c.minimumMonitors===null || c.minimumMonitors==='') c.minimumMonitors=0;
  c.missingRank=Math.max(1,Number(c.missingRank)||999);
  c.missingPoints=Number(c.missingPoints)||0;
  c.minimumMonitors=Math.max(0,Math.floor(Number(c.minimumMonitors)||0));
  c.zeroCanWin=!!c.zeroCanWin;
  c.minimumEnabled=!!c.minimumEnabled;
  c.minimum=Number(c.minimum)||0;
  c.points=Number(c.points)||1;
  c.autofailThreshold=Number(c.autofailThreshold)||1;
  c.withinUseRange=!!c.withinUseRange;
  c.withinDays=c.withinDays??c.days??'';
  c.withinRangeMin=c.withinRangeMin??'';
  c.withinRangeMax=c.withinRangeMax??'';
  c.autofailOperator=['greaterEqual','greaterThan','equals'].includes(c.autofailOperator)?c.autofailOperator:'greaterEqual';
  HEADER_FIELDS.forEach(f=>{ c[f]=plainHeaderName(c[f]); });
  c.expression=String(c.expression||'');
  c.checkText=String(c.checkText||'');
  ensureRowPullConditions(c);
  c.filters=(c.filters||[]).map(f=>normalizeFilterForStorage(f,c.source));
  return c;
}
function normalizeDisplayRule(rule){
  rule={...(rule||{})};
  return {id:rule.id||id(),op:['greater','greaterEqual','less','lessEqual','between','equals','contains','blank','notBlank','dateWithin','dateOlder'].includes(rule.op)?rule.op:'equals',value:String(rule.value??'').trim(),value2:String(rule.value2??'').trim(),display:String(rule.display??'').trim(),color:['none','red','yellow','green','blue','gray'].includes(rule.color)?rule.color:'none',style:rule.style==='badge'?'badge':'cell'};
}
function normalizeFilterForStorage(f, fallbackSource){
  f={...(f||{})};
  const rawAction=f.action || f.mode || 'exclude';
  const action=['include','exclude','includeWithin','excludeWithin'].includes(rawAction)?rawAction:(rawAction==='include'?'include':'exclude');
  const rawOperator=f.operator || 'is';
  const operator=['is','isNot','contains','notContains','greaterThan','greaterEqual','lessThan','lessEqual','between'].includes(rawOperator)?rawOperator:'is';
  return {
    ...f,
    id:f.id||id(),
    action,
    mode:action,
    operator,
    source:validSourceKey(f.source || fallbackSource || 'retail_sv2','retail_sv2'),
    column:plainHeaderName(f.column),
    values:(f.values||[]).map(v=>String(v??'').trim()).filter(Boolean),
    value:String(f.value??'').trim(),
    value2:String(f.value2??'').trim(),
    dynamic:!!f.dynamic,
    expression:String(f.expression??'').trim(),
    dynamicColumn:!!(f.dynamicColumn||f.columnDynamic),
    columnExpression:String(f.columnExpression??f.expressionColumn??'').trim(),
    targetSource:validSourceKey(f.targetSource||'qa','qa'),
    targetDateColumn:plainHeaderName(f.targetDateColumn),
    targetValueColumn:plainHeaderName(f.targetValueColumn),
    targetOp:['contains','is','does not contain','notContains'].includes(f.targetOp)?(f.targetOp==='notContains'?'does not contain':f.targetOp):(f.targetOp||'contains'),
    targetValue:String(f.targetValue??'').trim(),
    windowMode:f.windowMode==='range'?'range':'days',
    dayWindow:String(f.dayWindow??'0').trim(),
    rangeStart:String(f.rangeStart??'').trim(),
    rangeEnd:String(f.rangeEnd??'').trim()
  };
}
function isNumericFilterOperator(op){ return ['greaterThan','greaterEqual','lessThan','lessEqual','between'].includes(op); }
function isFreeTextFilterOperator(op){ return ['contains','notContains'].includes(op); }
function filterOperatorLabel(op){ return ({is:'Is',isNot:'Is not',contains:'Contains text',notContains:'Does not contain text',greaterThan:'Greater than',greaterEqual:'Greater than or equal to',lessThan:'Less than',lessEqual:'Less than or equal to',between:'Between'})[op]||'Is'; }

function rowPullOperatorLabel(op){ return ({contains:'Contains',equals:'Equals',notContains:'Does not contain',notEquals:'Does not equal',greaterThan:'Greater than',greaterEqual:'Greater than or equal to',lessThan:'Less than',lessEqual:'Less than or equal to',between:'Between'})[op]||'Contains'; }
const TEXT_ROW_PULL_OPERATORS = ['contains','equals','notContains','notEquals'];
const NUMERIC_ROW_PULL_OPERATORS = ['equals','notEquals','greaterThan','greaterEqual','lessThan','lessEqual','between'];
function rowPullOperatorsForType(valueType){ return valueType==='number' ? NUMERIC_ROW_PULL_OPERATORS : TEXT_ROW_PULL_OPERATORS; }
function rowPullDefaultOperator(valueType){ return valueType==='number' ? 'equals' : 'contains'; }
function normalizeRowPullOperator(op,valueType=''){
  const all=[...new Set([...TEXT_ROW_PULL_OPERATORS,...NUMERIC_ROW_PULL_OPERATORS])];
  if(valueType){ const allowed=rowPullOperatorsForType(valueType); return allowed.includes(op)?op:rowPullDefaultOperator(valueType); }
  return all.includes(op)?op:'contains';
}
function parseQuotedPhrases(text){
  const raw=String(text??'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim();
  if(!raw) return {ok:true,phrases:[],warning:''};
  if(!raw.includes('"')){
    const phrases=raw.split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean);
    return {ok:true,phrases,warning:''};
  }
  const phrases=[]; let i=0;
  while(i<raw.length){
    while(i<raw.length && /[\s,]/.test(raw[i])) i++;
    if(i>=raw.length) break;
    if(raw[i]!=='"'){
      let buf='';
      while(i<raw.length && raw[i]!==',') buf+=raw[i++];
      const phrase=buf.trim().replace(/^['"]|['"]$/g,'');
      if(phrase) phrases.push(phrase);
      if(raw[i]===',') i++;
      continue;
    }
    i++; let buf='', closed=false;
    while(i<raw.length){
      const ch=raw[i++];
      if(ch==='\\' && i<raw.length){ buf+=raw[i++]; continue; }
      if(ch==='"'){ closed=true; break; }
      buf+=ch;
    }
    if(!closed) return {ok:false,phrases:[],warning:'Finish the quoted phrase or use plain text, like Final, Written, or Verbal.'};
    const phrase=buf.trim();
    if(phrase) phrases.push(phrase);
    while(i<raw.length && /\s/.test(raw[i])) i++;
    if(i<raw.length && raw[i]===',') i++;
    else if(i<raw.length) return {ok:false,phrases,warning:'Separate multiple phrases with commas.'};
  }
  return {ok:true,phrases,warning:''};
}
function normalizeRowPullConnector(conn, idx){ return idx===0 ? 'base' : (['and','or','andSeparate'].includes(conn)?conn:'and'); }
function rowPullConnectorLabel(conn){ return ({and:'AND',or:'OR',andSeparate:'AND separate row (same representative)'})[conn]||'AND'; }
function normalizeRowPullCondition(cond, fallback, idx=0){
  cond={...(cond||{})};
  const connector=normalizeRowPullConnector(cond.connector, idx);
  return {id:cond.id||id(),connector,column:plainHeaderName(cond.column??fallback?.column??''),dateColumn:plainHeaderName(cond.dateColumn??fallback?.dateColumn??''),operator:normalizeRowPullOperator(cond.operator??fallback?.operator),phrasesText:String(cond.phrasesText??fallback?.phrasesText??'')};
}
function quotePhraseForMigration(text){
  const raw=String(text??'').trim();
  if(!raw || parseQuotedPhrases(raw).ok) return raw;
  return `"${raw.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
}
function ensureRowPullConditions(c){
  let list=Array.isArray(c.rowPullConditions)?c.rowPullConditions:[];
  if(!list.length && (c.checkColumn || c.checkText)) list=[{column:c.checkColumn,operator:c.checkOperator,phrasesText:quotePhraseForMigration(c.checkText)}];
  if(!list.length) list=[{column:'',operator:'contains',phrasesText:''}];
  c.rowPullConditions=list.map((x,i)=>normalizeRowPullCondition(x,null,i));
  const first=c.rowPullConditions[0]||{};
  c.checkColumn=plainHeaderName(c.checkColumn||first.column||'');
  c.checkOperator=normalizeRowPullOperator(c.checkOperator||first.operator);
  c.checkText=String(c.checkText||first.phrasesText||'');
  return c.rowPullConditions;
}
function parseRowPullNumericValues(text){
  let raw=String(text??'').trim();
  if(!raw) return [];
  raw=raw.replace(/(\d)\s+[-–—]\s+(\d)/g,'$1, $2').replace(/(\d)\s+to\s+(\d)/ig,'$1, $2');
  const parsed=parseQuotedPhrases(raw);
  const chunks=parsed.ok && parsed.phrases.length ? parsed.phrases : raw.split(/,|\band\b/i);
  const nums=[];
  chunks.forEach(chunk=>{
    const direct=toNum(chunk);
    if(Number.isFinite(direct)){ nums.push(direct); return; }
    String(chunk||'').match(/-?\d+(?:\.\d+)?%?/g)?.forEach(x=>{ const n=toNum(x); if(Number.isFinite(n)) nums.push(n); });
  });
  return nums;
}
function rowPullConditionPass(row, cond, valueType='text'){
  const type=valueType==='number'?'number':'text';
  if(type==='number'){
    const left=toNum(row[cond.column]);
    const nums=parseRowPullNumericValues(cond.phrasesText);
    if(!Number.isFinite(left) || !nums.length) return false;
    const op=normalizeRowPullOperator(cond.operator,'number');
    const first=nums[0], second=nums.length>1?nums[1]:NaN;
    if(op==='between') return numericComparisonPass(left,'between',first,second);
    if(op==='greaterThan') return numericComparisonPass(left,'greaterThan',first);
    if(op==='greaterEqual') return numericComparisonPass(left,'greaterEqual',first);
    if(op==='lessThan') return numericComparisonPass(left,'lessThan',first);
    if(op==='lessEqual') return numericComparisonPass(left,'lessEqual',first);
    if(op==='notEquals') return nums.every(n=>left!==n);
    return nums.some(n=>left===n);
  }
  const parsed=parseQuotedPhrases(cond.phrasesText);
  if(!parsed.ok || !parsed.phrases.length) return false;
  const val=normalizeResearchText(row[cond.column]);
  const phrases=parsed.phrases.map(p=>normalizeResearchText(p)).filter(Boolean);
  const op=normalizeRowPullOperator(cond.operator,'text');
  if(op==='equals') return phrases.some(p=>val===p);
  if(op==='notContains') return !phrases.some(p=>val.includes(p));
  if(op==='notEquals') return !phrases.some(p=>val===p);
  return phrases.some(p=>val.includes(p));
}
function rowPullWarnings(c){
  return ensureRowPullConditions(c).map(cond=>parseQuotedPhrases(cond.phrasesText).warning);
}
function checklistRowsForSeparateCondition(source, entry, opts, cond){
  return rowsForEntry(source, entry, {...opts,dateColumn:cond.dateColumn||opts.dateColumn}).filter(r=>rowPullConditionPass(r,cond,opts.checkValueType||'text'));
}
function checklistRowPassesConditions(source, row, entry, opts, conditions){
  const valueType=opts.checkValueType||'text';
  let result=true;
  conditions.forEach((cond,idx)=>{
    if(idx===0){ result=rowPullConditionPass(row,cond,valueType); return; }
    const pass=cond.connector==='andSeparate' ? checklistRowsForSeparateCondition(source,entry,opts,cond).length>0 : rowPullConditionPass(row,cond,valueType);
    result = cond.connector==='or' ? (result || pass) : (result && pass);
  });
  return result;
}
function numericComparisonPass(left, op, right, right2){
  if(!Number.isFinite(left)||!Number.isFinite(right)) return false;
  if(op==='between'){
    if(!Number.isFinite(right2)) return false;
    return left>=Math.min(right,right2) && left<=Math.max(right,right2);
  }
  if(op==='greaterThan') return left>right;
  if(op==='greaterEqual') return left>=right;
  if(op==='lessThan') return left<right;
  if(op==='lessEqual') return left<=right;
  return false;
}
function normalizeModelForStorage(m){
  m = {...(m||{})};
  m.id=m.id||id();
  m.name=String(m.name||'Untitled Model').trim();
  m.type=['both','team','rep'].includes(m.type)?m.type:'both';
  m.tiebreaker=m.tiebreaker||'overallScore';
  m.sourceSettings=normalizeSourceSettings(m.sourceSettings);
  m.criteria=(m.criteria||[]).map(c=>normalizeCriterionForStorage(c));
  if(m.tiebreaker!=='overallScore' && !m.criteria.some(c=>c.id===m.tiebreaker)) m.tiebreaker='overallScore';
  return m;
}
function normalizeModelName(name){
  return String(name||'').toLowerCase().trim().replace(/\s+/g,' ');
}
function upsertModel(model){
  const incoming=normalizeModelForStorage(model);
  const incomingName=normalizeModelName(incoming.name);
  const byId=(state.models||[]).findIndex(m=>m.id===incoming.id);
  const byName=(state.models||[]).findIndex(m=>normalizeModelName(m.name)===incomingName);
  const targetIndex=byId>=0 ? byId : byName;
  if(targetIndex>=0){
    const existing=normalizeModelForStorage(state.models[targetIndex]);
    incoming.id=existing.id;
  }
  const targetId=targetIndex>=0 ? incoming.id : null;
  state.models=(state.models||[]).filter((m,i)=>{
    const sameId=targetId && m.id===targetId;
    const sameName=normalizeModelName(m.name)===incomingName;
    if(targetIndex>=0) return !(sameId || sameName);
    return !sameName;
  });
  const insertAt=targetIndex>=0 ? Math.min(targetIndex,state.models.length) : state.models.length;
  state.models.splice(insertAt,0,incoming);
  return incoming;
}
function serializeModelsForExport(models){
  return JSON.stringify({version:4,exportedAt:new Date().toISOString(),models:(models||[]).map(normalizeModelForStorage),customSources:(state.customSources||[]).map(c=>({...clonePlain(c),rows:[],aoaBySheet:{}}))}, null, 2);
}
function parseModelsImportText(text){
  const obj=JSON.parse(String(text||''));
  if(obj && Array.isArray(obj.customSources)){ obj.customSources.forEach(def=>{ if(def.sourceKey && !customSource(def.sourceKey)){ state.customSources.push({...def,rows:def.rows||[],headers:def.headers||[],aoa:def.aoa||[],aoaBySheet:def.aoaBySheet||{}}); } }); renderCustomSourcesList(); }
  const incoming=Array.isArray(obj)?obj:(Array.isArray(obj.models)?obj.models:[obj]);
  if(!Array.isArray(incoming)) throw new Error('Imported file did not contain models.');
  return incoming.map(normalizeModelForStorage);
}
function norm(s){return String(s ?? '').toLowerCase().replace(/%/g,' percent ').replace(/&/g,' and ').trim().replace(/[^a-z0-9]+/g,'');}
function stripRepNameAnnotations(s){ return String(s ?? '').replace(/\s*(\([^)]*\)|\[[^\]]*\])\s*$/g,'').replace(/\s+/g,' ').trim(); }
function normalizeFullNameDisplay(value,options={}){
  let s=stripRepNameAnnotations(value).trim().replace(/\s+/g,' ');
  if(!s) return '';
  if(options.lastFirst!==false && s.includes(',')){
    const parts=s.split(',').map(x=>x.trim()).filter(Boolean);
    if(parts.length>=2){
      const last=parts.shift();
      const suffixes=new Set(['jr','sr','ii','iii','iv','v']);
      const tail=[];
      while(parts.length && suffixes.has(norm(parts[parts.length-1]))){ tail.unshift(parts.pop()); }
      s=[parts.join(' '),last,...tail].filter(Boolean).join(' ');
    }
  }
  s=s.replace(/[\u2018\u2019]/g,"'").replace(/[\u2010-\u2014]/g,'-').replace(/\s+/g,' ').trim();
  return titleCase(s);
}
function cleanName(s){ return normalizeFullNameDisplay(s); }
function titleCase(s){return String(s||'').toLowerCase().replace(/\b[a-z]/g,m=>m.toUpperCase()).replace(/\b([ivx]+|jr|sr)\b/gi,m=>m.toUpperCase()).replace(/\s+/g,' ').trim();}
function canonicalCoachName(s){ return cleanName(String(s ?? '').trim()); }
function coachNameKey(s){ return norm(canonicalCoachName(s)); }
function fullNameIdentityKey(s){
  const clean=normalizeFullNameDisplay(s);
  if(!clean) return '';
  return clean.toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[\u2010-\u2014]/g,'-').replace(/\./g,'').replace(/[^a-z0-9\s'-]/g,' ').replace(/\s+/g,' ').trim();
}
function nameKey(s){ return fullNameIdentityKey(s); }
function legacyFirstLastNameKey(s){
  s=normalizeFullNameDisplay(s).toLowerCase().replace(/[^a-z0-9\s'-]/g,' ').replace(/\s+/g,' ').trim();
  const parts=s.split(' ').filter(Boolean);
  if(parts.length>=2) return `${parts[0]} ${parts[parts.length-1]}`;
  return parts[0]||'';
}
function aliasLookupKey(name,sourceArea='global'){ const key=fullNameIdentityKey(name); return key ? `${sourceArea||'global'}|${key}` : ''; }
function aliasTargetsForName(name,sourceArea='global'){
  const out=[]; const full=fullNameIdentityKey(name); if(!full) return out;
  const keys=[aliasLookupKey(name,sourceArea)];
  keys.forEach(k=>{ const rec=state.repAliases?.get?.(k); if(rec && !rec.legacy) out.push(rec); });
  return out;
}
function canonicalRepName(name,sourceArea='global'){
  const cleaned=normalizeFullNameDisplay(name);
  if(!cleaned) return '';
  const targets=aliasTargetsForName(cleaned,sourceArea);
  if(targets.length===1 && targets[0].canonical) return cleanName(targets[0].canonical);
  return cleaned;
}
function trustedRosterKeySet(sourceArea=''){
  const set=new Set();
  const rows=[...(state.data?.retail?.controlRoster||[]),...(state.data?.referral?.controlRoster||[])];
  rows.forEach(r=>{ const src=r.sourceArea||r.source||''; if(sourceArea && src!==sourceArea) return; const key=fullNameIdentityKey(r.displayName||r.originalName||r._rep||r.representative||''); if(key) set.add(key); });
  return set;
}
function validateRepAlias(aliasName, canonicalName, sourceArea='global'){
  const aliasKey=fullNameIdentityKey(aliasName), canonicalKey=fullNameIdentityKey(canonicalName);
  if(!aliasKey||!canonicalKey) return {ok:false,message:'Mapping blocked: representative mapping must include both names.'};
  if(sourceArea==='global') return {ok:false,message:'Mapping blocked: global representative mappings are no longer created automatically.'};
  const roster=trustedRosterKeySet(sourceArea);
  if(aliasKey!==canonicalKey && roster.has(aliasKey)) return {ok:false,message:`Mapping blocked: “${cleanName(aliasName)}” is already a distinct representative in the trusted Control roster.`};
  if(!roster.has(canonicalKey)) return {ok:false,message:`Mapping blocked: “${cleanName(canonicalName)}” is not a trusted Control-roster representative for ${sourceArea}.`};
  return {ok:true,message:''};
}
function addRepAlias(aliasName, canonicalName, sourceArea='global', meta={}){
  const validation=validateRepAlias(aliasName,canonicalName,sourceArea);
  const rec={alias:fullNameIdentityKey(aliasName),aliasName:cleanName(aliasName),canonical:cleanName(canonicalName),sourceArea,legacy:!!meta.legacy,createdBy:meta.createdBy||'user'};
  if(!validation.ok){ state.quarantinedRepAliases=state.quarantinedRepAliases||[]; state.quarantinedRepAliases.push({...rec,reason:validation.message}); return {ok:false,message:validation.message}; }
  const key=aliasLookupKey(aliasName,sourceArea);
  if(key) state.repAliases.set(key,rec);
  return {ok:true,message:''};
}
function loadRepAliases(){
  try{
    const raw=JSON.parse(localStorage.getItem(REP_ALIAS_KEY)||'[]');
    const map=new Map(), quarantined=[];
    (Array.isArray(raw)?raw:[]).forEach(x=>{
      const alias=x.aliasName||x.alias||x[0], canonical=cleanName(x.canonical||x[1]), sourceArea=x.sourceArea||'global';
      if(!alias||!canonical) return;
      const unsafe=(x.legacy===true) || sourceArea==='global' || (String(alias).split('|').pop()===legacyFirstLastNameKey(alias) && legacyFirstLastNameKey(alias)!==fullNameIdentityKey(alias));
      const rec={alias:fullNameIdentityKey(alias),aliasName:cleanName(alias),canonical,sourceArea,legacy:unsafe};
      if(unsafe){ quarantined.push({...rec,reason:sourceArea==='global'?'Legacy global aliases are quarantined until reviewed.':'Legacy first/last alias quarantined.'}); return; }
      const key=aliasLookupKey(alias,sourceArea);
      if(key) map.set(key,rec);
    });
    state.repAliases=map; state.quarantinedRepAliases=quarantined;
  }catch(_){ state.repAliases=new Map(); state.quarantinedRepAliases=[]; }
}
function revalidateRepAliases(){
  const active=new Map(), quarantine=[...(state.quarantinedRepAliases||[])];
  (state.repAliases||new Map()).forEach((rec,k)=>{
    const v=validateRepAlias(rec.aliasName||rec.alias,rec.canonical,rec.sourceArea||'global');
    if(v.ok) active.set(k,rec); else quarantine.push({...rec,reason:v.message});
  });
  state.repAliases=active; state.quarantinedRepAliases=quarantine;
}
function saveRepAliases(){ bumpVersion('aliases');
  const rows=[...(state.repAliases||new Map()).values()].map(x=>({alias:x.alias,aliasName:x.aliasName,canonical:cleanName(x.canonical),sourceArea:x.sourceArea||'global',legacy:!!x.legacy})).filter(x=>x.alias&&x.canonical);
  localStorage.setItem(REP_ALIAS_KEY,JSON.stringify(rows));
  markImportCacheDirty('misc','aliases','representative aliases changed'); scheduleImportedDataSave('representative aliases changed',{delay:500});
  bumpVersion('aliases'); invalidateRosterIndex('aliases changed'); state._controlRosterCache=null; state.teamDetailsCache?.clear?.();
}
function mergeRepDisplay(existing, incoming){
  if(incoming?.team) incoming={...incoming,team:canonicalCoachName(incoming.team)};
  if(existing?.team) existing={...existing,team:canonicalCoachName(existing.team)};
  if(!existing) return incoming;
  if(!incoming) return existing;
  if(!existing.team && incoming.team) return {...incoming,name:cleanName(incoming.name||existing.name)};
  return {...existing,name:cleanName(existing.name||incoming.name),team:existing.team||incoming.team||''};
}
function lastFirstToFirstLast(v){
  const s=String(v??'').trim().replace(/\s+/g,' ');
  if(!s) return '';
  if(s.includes(',')) return cleanName(s);
  const p=s.split(' ').filter(Boolean);
  if(p.length>=2) return cleanName(`${p.slice(1).join(' ')} ${p[0]}`);
  return cleanName(s);
}
function toNum(v){
  if(v===null||v===undefined||v==='') return NaN;
  if(typeof v==='number') return Number.isFinite(v)?v:NaN;
  const n=parseFloat(String(v).replace(/,/g,'').replace(/%/g,'').trim());
  return Number.isFinite(n)?n:NaN;
}
function parseDate(v){
  if(v instanceof Date && !isNaN(v)) return v;
  if(v===null||v===undefined||v==='') return null;
  if(typeof v==='number' && Number.isFinite(v)){
    if(v>20000 && v<80000) return new Date(Date.UTC(1899,11,30)+v*86400000);
    if(v>1e11) return new Date(v);
    return null;
  }
  const s=String(v).trim();
  if(!s) return null;
  if(/^\d+(\.\d+)?$/.test(s)){
    const n=Number(s);
    if(n>20000 && n<80000) return new Date(Date.UTC(1899,11,30)+n*86400000);
    if(n>1e11) return new Date(n);
    return null;
  }
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
  if(m){let y=+m[3]; if(y<100)y=y<70?2000+y:1900+y; let h=m[4]?+m[4]:0; const min=m[5]?+m[5]:0; const ap=(m[6]||'').toUpperCase(); if(ap==='PM'&&h<12)h+=12; if(ap==='AM'&&h===12)h=0; return new Date(y,+m[1]-1,+m[2],h,min);}
  const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso) return new Date(+iso[1],+iso[2]-1,+iso[3]);
  const d=new Date(s); return isNaN(d)?null:d;
}
function parseDateOnly(v){
  const d=parseDate(v);
  if(!(d instanceof Date)||isNaN(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function ymd(d){if(!(d instanceof Date)||isNaN(d)) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function inRange(d, start, end){
  if(!start&&!end) return true;
  const x=parseDateOnly(d); if(!x) return false;
  const s=start?parseDateOnly(start):null, e=end?parseDateOnly(end):null;
  return (!s || x>=s) && (!e || x<=e);
}
function weekStartOffset(day){ return String(day||'sunday').toLowerCase()==='monday' ? 1 : 0; }
function startOfWeekDate(d, weekStart='sunday'){
  const x=parseDateOnly(d); if(!x) return null;
  const offset=weekStartOffset(weekStart), diff=(x.getDay()-offset+7)%7;
  x.setDate(x.getDate()-diff); return x;
}
function parseWeekLabel(v, weekStart='sunday'){
  if(v===null||v===undefined||String(v).trim()==='') return null;
  const s=String(v).trim();
  const isoWeek=s.match(/^(\d{4})-W(\d{1,2})$/i);
  if(isoWeek){
    const y=+isoWeek[1], w=+isoWeek[2], jan4=new Date(y,0,4), mon=startOfWeekDate(jan4,'monday');
    mon.setDate(mon.getDate()+(w-1)*7);
    return startOfWeekDate(mon,weekStart);
  }
  const cleaned=s.replace(/^\s*week\s+of\s+/i,'');
  const d=parseDateOnly(cleaned)||parseDateOnly(s);
  return d ? startOfWeekDate(d,weekStart) : null;
}
function weekRangeForLabel(v, weekStart='sunday'){
  const start=parseWeekLabel(v,weekStart); if(!start) return null;
  const end=new Date(start); end.setDate(end.getDate()+6); return {start,end};
}
function weeklyRowDateBasis(source, opts={}){
  const cols=customSource(source)?.columns||{};
  if(opts.dateBasis==='week' || opts.dateColumn===cols.week) return 'week';
  if(opts.dateBasis==='date' || opts.dateColumn===cols.date) return 'date';
  return cols.date ? 'date' : 'week';
}
function weeklyRowInRange(source,row,opts={}){
  if(!opts.start&&!opts.end) return true;
  const cols=customSource(source)?.columns||{}, basis=weeklyRowDateBasis(source,opts), weekStart=opts.weekStart||cols.weekStart||'sunday';
  if(basis==='date' && cols.date) return inRange(row[cols.date]||row._date,opts.start,opts.end);
  const wr=weekRangeForLabel((cols.week&&row[cols.week])||row._week||row._date,weekStart); if(!wr) return false;
  const s=opts.start?parseDateOnly(opts.start):null, e=opts.end?parseDateOnly(opts.end):null;
  return (!s || wr.end>=s) && (!e || wr.start<=e);
}
function weeklyRowWeekKey(source,row,opts={}){
  const cols=customSource(source)?.columns||{}, weekStart=opts.weekStart||cols.weekStart||'sunday';
  return ymd(parseWeekLabel((cols.week&&row[cols.week])||row._week||(cols.date&&row[cols.date])||row._date,weekStart));
}
function fmt(v, type){
  if(v===null||v===undefined||!Number.isFinite(v)) return '—';
  if(type==='pct') return `${v.toFixed(2)}%`;
  if(Math.abs(v)>=1000) return v.toLocaleString(undefined,{maximumFractionDigits:2});
  return String(Math.round(v*1000)/1000);
}
function openModal(id){el(id).classList.add('open');}
function closeModal(id){
  if(id==='researchModal'){ if(state.researchRenderToken) state.researchRenderToken.cancelled=true; cancelResearchRenderAll(); }
  el(id).classList.remove('open');
}

let currentColumnPreview={source:'',column:'',items:[]};
function showColumnPreview(source,column){
  const modal=el('columnPreviewModal'), title=el('columnPreviewTitle'), note=el('columnPreviewNote'), search=el('columnPreviewSearch');
  if(!modal||!column){ alert('Select a column before previewing values.'); return; }
  const rows=getRows(source,{}), counts=new Map();
  rows.forEach(r=>{ const raw=String(r[column]??'').trim(); const key=raw || '(blank)'; counts.set(key,(counts.get(key)||0)+1); });
  const items=Array.from(counts.entries()).map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value));
  currentColumnPreview={source,column,items};
  title.textContent=`Column Preview: ${column}`;
  note.textContent=`Showing up to 200 unique/sample values${items.length>200?` out of ${items.length}. Use search to narrow the list.`:` (${items.length} total).`}`;
  search.value='';
  renderColumnPreviewValues();
  modal.classList.add('open');
  setTimeout(()=>search.focus(),0);
}
function renderColumnPreviewValues(){
  const box=el('columnPreviewValues'), search=el('columnPreviewSearch'); if(!box) return;
  const q=String(search?.value||'').toLowerCase().trim();
  const shown=currentColumnPreview.items.filter(x=>!q || x.value.toLowerCase().includes(q)).slice(0,200);
  box.innerHTML=shown.length ? shown.map(x=>`<div class="previewValueRow"><span>${esc(x.value)}</span><span class="previewCount">${x.count}</span></div>`).join('') : '<div class="previewValueRow"><em>No matching values.</em></div>';
}
function closeColumnPreview(){ closeModal('columnPreviewModal'); }
function setStatus(){
  if(state.lifecycle?.closing) return;
  els.topStatus.textContent = 'Allstar Report';
}
function clampPct(p){ return Math.max(0,Math.min(100,Math.round(Number(p)||0))); }
function activeAllStarProgressJob(){
  const job=state.progressJob;
  return job && !job.cancelled && !job.complete ? job : null;
}
function renderProgressValue(text,p){
  if(state.lifecycle?.closing || !els.loadingOverlay) return;
  els.loadingOverlay.classList.add('open');
  els.loadingOverlay.setAttribute('aria-hidden','false');
  if(els.loadingText) els.loadingText.textContent=text||'Working...';
  if(els.loadingBarFill) els.loadingBarFill.style.width=p+'%';
  if(els.loadingPct) els.loadingPct.textContent=p+'%';
}
function createAllStarStartupJob(label='Opening Allstar…'){
  const previous=activeAllStarProgressJob(); if(previous) previous.cancelled=true;
  const job={id:`startup-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,kind:'startup',label,lastPct:0,phaseStart:0,phaseEnd:100,regressions:0,preventedRegressions:0,updates:[],cancelled:false,complete:false};
  state.progressJob=job; state.startup.job=job;
  renderProgressValue(label,0);
  return job;
}
function setAllStarStartupPhase(job,start,end,label=''){
  if(!job || activeAllStarProgressJob()!==job) return false;
  job.phaseStart=clampPct(start); job.phaseEnd=Math.max(job.phaseStart,clampPct(end));
  if(label) updateAllStarStartupProgress(job,label,job.phaseStart);
  return true;
}
function updateAllStarStartupProgress(job,text,pct){
  if(!job || activeAllStarProgressJob()!==job) return false;
  updateProgress(text,pct,{force:true,jobDirect:true,job});
  return true;
}
function finishAllStarStartupProgress(job,text='Ready.'){
  if(!job || activeAllStarProgressJob()!==job) return false;
  updateProgress(text,100,{force:true,jobDirect:true,job}); job.complete=true;
  state.startup.diagnostics={...(state.startup.diagnostics||{}),progressRegressions:job.regressions,preventedProgressRegressions:job.preventedRegressions,progressUpdates:job.updates.slice(-30)};
  state.progressJob=null;
  setTimeout(()=>{ if(!state.lifecycle?.closing && !activeAllStarProgressJob()) hideProgress({force:true}); },180);
  return true;
}
function cancelAllStarProgressJob(reason='cancelled'){
  const job=activeAllStarProgressJob(); if(!job) return false;
  job.cancelled=true; job.cancelReason=reason; state.progressJob=null;
  hideProgress({force:true}); return true;
}
function showProgress(text='Working...', pct=0, opts={}){
  if(state.lifecycle?.closing || !els.loadingOverlay) return;
  els.loadingOverlay.classList.add('open');
  els.loadingOverlay.setAttribute('aria-hidden','false');
  updateProgress(text,pct,{...opts,force:true});
}
let lastProgressUpdateAt=0, lastProgressText='', lastProgressPct=-1;
function updateProgress(text,pct, opts={}){
  if(state.lifecycle?.closing) return false;
  const job=activeAllStarProgressJob();
  if(opts.job && job!==opts.job) return false;
  let requested=clampPct(pct), p=requested;
  if(job){
    if(!opts.jobDirect) p=job.phaseStart+(job.phaseEnd-job.phaseStart)*(requested/100);
    p=clampPct(p);
    if(p<job.lastPct){ job.preventedRegressions++; p=job.lastPct; }
    job.lastPct=Math.max(job.lastPct,p);
    job.updates.push({pct:job.lastPct,text:String(text||''),at:Date.now()});
    if(job.updates.length>100) job.updates.splice(0,job.updates.length-100);
    p=job.lastPct;
  }
  const now=performance.now();
  const force=!!opts.force || p>=100 || p<=0;
  if(!force && text===lastProgressText && Math.abs(p-lastProgressPct)<2 && now-lastProgressUpdateAt<160) return;
  lastProgressUpdateAt=now; lastProgressText=text; lastProgressPct=p;
  renderProgressValue(text,p);
  return true;
}
function hideProgress(opts={}){
  if(activeAllStarProgressJob() && !opts.force) return false;
  if(!els.loadingOverlay) return;
  els.loadingOverlay.classList.remove('open');
  els.loadingOverlay.setAttribute('aria-hidden','true');
  return true;
}

const researchProgressController={token:null,lastPct:0,visible:false};
function beginResearchProgress(label='Rendering Research...', pct=0){
  const token={id:Date.now()+Math.random(),cancelled:false,label};
  if(researchProgressController.token) researchProgressController.token.cancelled=true;
  researchProgressController.token=token;
  researchProgressController.lastPct=0;
  researchProgressController.visible=true;
  showProgress(label, pct);
  return token;
}
function researchProgressActive(token){ return !!token && researchProgressController.token===token && !token.cancelled; }
function updateResearchProgress(token,text,pct,opts={}){
  if(!researchProgressActive(token)) return false;
  const p=clampPct(Math.max(researchProgressController.lastPct, Number(pct)||0));
  researchProgressController.lastPct=p;
  updateProgress(text,p,opts);
  return true;
}
function finishResearchProgress(token,text='Research render complete'){
  if(!researchProgressActive(token)) return false;
  researchProgressController.lastPct=100;
  updateProgress(text,100,{force:true});
  return true;
}
function hideResearchProgress(token){
  if(!researchProgressActive(token)) return false;
  hideProgress();
  researchProgressController.visible=false;
  researchProgressController.token=null;
  return true;
}
function researchProgressReporter(token,start=0,end=100,status=false){
  return {token,start,end,status,update(stage,done,total){
    const safe=Math.max(1,total||0), pct=start+(end-start)*Math.min(1,Math.max(0,(done||0)/safe));
    updateResearchProgress(token,`${stage||'Processing research table'}... ${(done||0).toLocaleString()} / ${(total||0).toLocaleString()} rows`,pct);
    if(status) setResearchCanvasStatus(`${stage||'Processing research table'}... ${(done||0).toLocaleString()} / ${(total||0).toLocaleString()} rows`);
  }};
}
function estimateResearchItemWork(item){
  const rows=researchExecutionSources(item).reduce((sum,source)=>sum+(getRowsRaw(source)||[]).length,0)||researchSourceRowsForItem(item).length||1, cols=Math.max(1,(expandedResearchColumns(item)||item.columns||[]).length||1);
  const filters=(item.filters||[]).length+Object.keys(item.gearFilters||{}).length;
  const type=item.outputType==='conversation'?0.4:(item.outputType==='table'?1.2:0.9);
  const complex=1+filters*.25+cols*.35+(researchProcessingStepCount(item)||0)*.2;
  return Math.max(1, Math.round(rows*complex*type));
}
const RESEARCH_BATCH_SIZE=1000;
const PERCENT_BUILDER_PREP_BATCH_SIZE=2500;
function yieldToBrowser(){ return new Promise(resolve=>setTimeout(resolve,0)); }
const IMPORT_CHUNK_SIZE=1000;
function importTiming(label){
  const t0=performance.now(), marks=[];
  return {
    mark(phase, detail=''){ const now=performance.now(); marks.push({phase, ms:Math.round(now-t0), deltaMs:Math.round(now-(marks.at(-1)?._now||t0)), detail, _now:now}); console.info('[Import Timing]', label, phase, marks.at(-1)); },
    end(detail=''){ const totalMs=Math.round(performance.now()-t0); console.info('[Import Timing]', label, {totalMs, detail, phases:marks.map(({_now,...m})=>m)}); return totalMs; }
  };
}
async function mapRowsChunked(rows, mapper, keep, label='Processing rows', start=0, end=100, chunkSize=1000){
  rows=rows||[];
  const out=[];
  const span=end-start;
  const total=Math.max(1,rows.length);
  let sliceStart=performance.now();
  for(let i=0;i<rows.length;i++){
    if(state.lifecycle?.closing || state.lifecycle?.hidden) throw Object.assign(new Error('Allstar work cancelled by the application lifecycle.'),{cancelled:true});
    const mapped=mapper(rows[i],i);
    if(!keep || keep(mapped)) out.push(mapped);
    if(performance.now()-sliceStart>=10){
      updateProgress(`${label} (${(i+1).toLocaleString()}/${rows.length.toLocaleString()})`, start + span*((i+1)/total));
      await yieldToBrowser();
      sliceStart=performance.now();
    }
  }
  updateProgress(`${label} complete`, end);
  await yieldToBrowser();
  return out;
}
async function forEachChunked(items, fn, label='Processing', start=0, end=100, chunkSize=IMPORT_CHUNK_SIZE){
  items=items||[];
  const total=Math.max(1,items.length), span=end-start;
  let sliceStart=performance.now();
  for(let i=0;i<items.length;i++){
    if(state.lifecycle?.closing || state.lifecycle?.hidden) throw Object.assign(new Error('Allstar work cancelled by the application lifecycle.'),{cancelled:true});
    fn(items[i],i);
    if(performance.now()-sliceStart>=10 || i===items.length-1){
      updateProgress(`${label} (${Math.min(i+1,items.length).toLocaleString()} / ${items.length.toLocaleString()})`, start + span*((i+1)/total));
      await yieldToBrowser();
      sliceStart=performance.now();
    }
  }
}
function loadModels(){
  try{ const raw=localStorage.getItem(MODEL_KEY); state.models=raw?JSON.parse(raw):[]; }catch(e){ state.models=[]; }
  state.models=(state.models||[]).map(normalizeModelForStorage);
  if(!state.models.length){
    state.models=[defaultQAModel()]; saveModels();
  }
}
function saveModels(){ bumpVersion('models'); state.models=(state.models||[]).map(normalizeModelForStorage); localStorage.setItem(MODEL_KEY, JSON.stringify(state.models)); markImportCacheDirty('misc','sourceSettings','source settings changed'); scheduleImportedDataSave('source settings changed',{delay:700}); selectiveResearchInvalidation({reason:'model setup changed',models:true}); renderModelList(); populateRunModels(); }
function defaultQAModel(){
  return normalizeModelForStorage({id:id(),name:'QA Score',type:'both',tiebreaker:'overallScore',criteria:[{id:id(),name:'QA Score %',source:'qa',calcType:'qaScore',audience:'both',scoreType:'rank',direction:'higher',weight:'1',format:'pct',missingRank:999,missingPoints:0,zeroCanWin:false,minimumMonitors:0,filters:[],minimumEnabled:false,minimum:0,autofailThreshold:1,autofailOperator:'greaterEqual'}]});
}
function emptyCriterion(){
  return {id:id(),name:'New Criteria',source:'retail_sv2',calcType:'single',audience:'both',scoreType:'rank',direction:'higher',weight:'1',format:'number',missingRank:999,missingPoints:0,zeroCanWin:false,minimumMonitors:0,column:'',aggregate:'sum',withinCompareColumn:'',withinUseRange:false,withinDays:'',withinRangeMin:'',withinRangeMax:'',leftSource:'retail_sv2',leftColumn:'',operator:'divide',rightSource:'retail_sv2',rightColumn:'',customSource:'retail_sv2',expression:'',checkDateColumn:'',checkColumn:'',checkOperator:'contains',checkValueType:'text',checkText:'',filters:[],minimumEnabled:false,minimum:0,points:1,autofailThreshold:1,autofailOperator:'greaterEqual',trueValueEnabled:false,trueValueSource:'',trueValueColumn:'',lookupVersion:2,displayMode:'lookup',lookupMatchEntity:'representative',lookupMatchColumn:'',lookupReturnColumn:'',lookupDateColumn:'',lookupCustomValue:'',lookupSelection:'latest',displayCalculation:'raw',displayValueType:'auto',displayMissingMode:'blank',displayMissingText:'',displayRules:[]};
}
function getHeaders(source){
  if(source===NONDATED_SOURCE) return state.categorized.nondated.headers || ['Representative','Coach'];
  if(source===DATED_SOURCE) return state.categorized.dated.headers || ['Representative','Coach','Date'];
  if(isCustomSource(source)) return customSource(source)?.headers||[];
  if(source==='retail_sv2') return state.data.retail.headers.sv2;
  if(source==='retail_wiper') return state.data.retail.headers.wiper;
  if(source==='retail_team_totals') return state.data.retail.teamTotals?.headers || [];
  if(source==='referral_sv2') return state.data.referral.headers.sv2;
  if(source==='referral_wiper') return state.data.referral.headers.wiper;
  if(source==='referral_team_totals') return state.data.referral.teamTotals?.headers || [];
  if(source==='qa') return state.data.qa.headers;
  if(source===QA_DIRECT_SOURCE) return state.data.qa_direct?.headers || [];
  if(source==='checklist') return state.data.checklist.headers;
  if(source==='documented_coaching') return state.data.documented_coaching.headers;
  if(source==='comp_calls') return state.data.comp_calls.headers;
  return [];
}
function allSourceKeys(){ return [NONDATED_SOURCE,DATED_SOURCE,'retail_sv2','retail_wiper','retail_team_totals','referral_sv2','referral_wiper','referral_team_totals','qa',QA_DIRECT_SOURCE,'checklist','documented_coaching','comp_calls',...customSourceKeys()]; }
function getRowsRaw(source){
  if(source===NONDATED_SOURCE) return state.categorized.nondated.rows || [];
  if(source===DATED_SOURCE) return state.categorized.dated.rows || [];
  if(isCustomSource(source)) return customSource(source)?.rows||[];
  if(source==='retail_sv2') return state.data.retail.sv2 || [];
  if(source==='retail_wiper') return state.data.retail.wiper || [];
  if(source==='retail_team_totals') return state.data.retail.teamTotals?.rows || [];
  if(source==='referral_sv2') return state.data.referral.sv2 || [];
  if(source==='referral_wiper') return state.data.referral.wiper || [];
  if(source==='referral_team_totals') return state.data.referral.teamTotals?.rows || [];
  if(source==='qa') return state.data.qa.rows || [];
  if(source===QA_DIRECT_SOURCE) return state.data.qa_direct?.rows || [];
  if(source==='checklist') return state.data.checklist.rows || [];
  if(source==='documented_coaching') return state.data.documented_coaching.rows || [];
  if(source==='comp_calls') return state.data.comp_calls.rows || [];
  return [];
}
function filterRowsForSource(source, rows, opts={}){
  rows=rows||[];
  if(source===NONDATED_SOURCE) return rows;
  if(source===DATED_SOURCE){
    const dateCol=resolveColumn(source,opts.dateColumn||'Date') || 'Date';
    return (!opts.start&&!opts.end) ? rows : rows.filter(r=>inRange(r[dateCol]||r.Date||r._date, opts.start, opts.end));
  }
  if(source==='qa' || source===QA_DIRECT_SOURCE) return filterQARowsByDate(rows, opts.start, opts.end, opts.qaDateMode);
  if(isChecklistLikeSource(source)) return filterChecklistRowsByDate(source, rows, opts.start, opts.end, opts.dateColumn);
  if(isCustomWeeklyStatSource(source)) return rows.filter(r=>weeklyRowInRange(source,r,opts));
  if(isCustomSource(source)){ const col=opts.dateColumn||customDateColumn(source); return col ? rows.filter(r=>inRange(r[col]||r._date||r._week, opts.start, opts.end)) : rows; }
  return rows;
}
function getRows(source, opts={}){
  return filterRowsForSource(source, getRowsRaw(source), opts);
}
function sourceRows(source, opts={}){ return getRows(source, opts); }
function sourceHeaders(source){ return getHeaders(source); }
function rowsCacheKey(source, opts={}){
  return [source, ymd(opts.start), ymd(opts.end), opts.qaDateMode||'', opts.dateColumn||'', opts.dateBasis||'', opts.weekStart||''].join('|');
}
function dataIndexReady(){ return !!(state.dataIndex && !state.dataIndex.dirty && state.dataIndex.sources); }
function dataIndexSignature(){
  const sourceSig=allSourceKeys().map(src=>{
    const rows=getRowsRaw(src)||[], headers=getHeaders(src)||[], cs=isCustomSource(src)?customSource(src):null;
    const fn=cs?.fileName || (src.startsWith('retail')?state.data.retail.fileName:src.startsWith('referral')?state.data.referral.fileName:(state.data[src]?.fileName||''));
    return [src,rows.length,headers.length,headers.join('\u001f'),fn].join('\u001e');
  }).join('\u001d');
  return `${sourceSig}\u001dcontrolRoster:${controlRosterSignature()}`;
}

function bumpVersion(key){
  state.versions=state.versions||{data:0,retail:0,referral:0,roster:0,aliases:0,teams:0,mappings:0,models:0,metrics:0,researchDefinitions:0,research:0};
  if(key && Object.prototype.hasOwnProperty.call(state.versions,key)) state.versions[key]++;
  if(key!=='data') state.versions.data++;
}
function rosterIndexSignature(){
  const v=state.versions||{};
  return [CONTROL_ROSTER_SCHEMA_VERSION,v.roster||0,v.aliases||0,v.teams||0,v.mappings||0,controlRosterSignature(),(state.repAliases||new Map()).size,(state.quarantinedRepAliases||[]).length].join('|');
}
function emptyRosterIndex(signature=''){
  return {version:(state.rosterIndex?.version||0)+1,signature,rows:[],byRosterId:new Map(),bySourceRepKey:new Map(),byRepKey:new Map(),byTeamKey:new Map(),repsByTeamKey:new Map(),teamSummaries:new Map(),conflicts:[]};
}
function invalidateRosterIndex(reason='roster changed'){
  if(state.rosterIndex) state.rosterIndex.signature='';
  state._controlRosterCache=null; state.teamIndexCache=null; state.teamDetailsCache?.clear?.(); state.repSuggestionCache?.clear?.(); state.repCandidateCache=null; state.quarantineIndexCache=null;
}
function sourceRepCompositeKey(sourceArea,repKey){ return `${sourceArea||''}\u0000${repKey||''}`; }

function quarantineIndexSignature(){
  const v=state.versions||{};
  return [v.aliases||0,v.roster||0,v.teams||0,v.mappings||0,v.data||0,controlRosterSignature(),(state.quarantinedRepAliases||[]).length].join('|');
}
function emptyQuarantineIndex(signature=''){
  return {signature,byTeamKey:new Map(),unassigned:[],records:[]};
}
function importedRowsMatchingAlias(aliasName,sourceArea=''){
  const key=fullNameIdentityKey(aliasName);
  if(!key) return [];
  const rows=[];
  allSourceKeys().forEach(src=>{
    const area=sourceAreaForSource(src)||'';
    if(sourceArea && area!==sourceArea) return;
    (getRowsRaw(src)||[]).forEach(r=>{
      const raw=r?._rawRep || r?._rep || r?.Representative || r?.representative || r?.['Agent Name'] || r?.['Associate Name'] || r?.['Associate name'] || r?.Name || '';
      if(fullNameIdentityKey(raw)===key) rows.push({row:r,source:src,sourceArea:area,team:canonicalCoachName(r?._team||directTeamFromAnyRow(r)||'')});
    });
  });
  return rows;
}
function quarantineTeamAssociations(rec){
  const sourceArea=rec.sourceArea||'global', canonicalKey=fullNameIdentityKey(rec.canonical||'');
  const teams=new Map();
  const add=(team,method,extra={})=>{ const teamName=canonicalCoachName(team); if(!teamName) return; const key=coachNameKey(teamName); const prev=teams.get(key)||{team:teamName,teamKey:key,method,canonicalOnTeam:false,aliasFoundInRows:false,ambiguous:false}; teams.set(key,{...prev,...extra,method:prev.method==='exact'?'exact':method}); };
  const canonicalRoster=controlRosterRows().filter(r=>(!sourceArea || sourceArea==='global' || r.sourceArea===sourceArea) && r._repKey===canonicalKey);
  canonicalRoster.forEach(r=>add(r._team,'exact',{canonicalOnTeam:true}));
  if(!teams.size){
    importedRowsMatchingAlias(rec.aliasName||rec.alias,sourceArea==='global'?'':sourceArea).forEach(hit=>{ if(hit.team) add(hit.team,'inferred',{aliasFoundInRows:true}); });
  }
  const values=[...teams.values()];
  const ambiguous=values.length>1 || canonicalRoster.map(r=>coachNameKey(r._team)).filter((v,i,a)=>v&&a.indexOf(v)===i).length>1;
  return values.map(x=>({...x,ambiguous,method:ambiguous?'ambiguous':x.method,aliasFoundInRows:x.aliasFoundInRows || importedRowsMatchingAlias(rec.aliasName||rec.alias,sourceArea==='global'?'':sourceArea).length>0}));
}
function ensureQuarantineIndex(){
  const signature=quarantineIndexSignature();
  if(state.quarantineIndexCache?.signature===signature) return state.quarantineIndexCache;
  const out=emptyQuarantineIndex(signature);
  (state.quarantinedRepAliases||[]).forEach((rec,i)=>{
    const associations=quarantineTeamAssociations(rec);
    const base={...rec,_qid:`q${i}`,aliasName:cleanName(rec.aliasName||rec.alias||''),canonical:cleanName(rec.canonical||''),sourceArea:rec.sourceArea||'global',reason:rec.reason||'Quarantined by representative alias safety validation.',createdBy:rec.createdBy||'',legacy:!!rec.legacy};
    if(!associations.length){ const q={...base,association:'unassigned',teamKey:'',team:'',canonicalOnTeam:false,aliasFoundInRows:importedRowsMatchingAlias(base.aliasName,base.sourceArea==='global'?'':base.sourceArea).length>0,ambiguous:false}; out.unassigned.push(q); out.records.push(q); return; }
    associations.forEach(a=>{ const q={...base,association:a.method,team:a.team,teamKey:a.teamKey,canonicalOnTeam:!!a.canonicalOnTeam,aliasFoundInRows:!!a.aliasFoundInRows,ambiguous:!!a.ambiguous}; if(!out.byTeamKey.has(a.teamKey)) out.byTeamKey.set(a.teamKey,[]); out.byTeamKey.get(a.teamKey).push(q); out.records.push(q); });
  });
  state.quarantineIndexCache=out; return out;
}
function quarantinesForTeam(team){ return ensureQuarantineIndex().byTeamKey.get(coachNameKey(team))||[]; }

function ensureRosterIndex(){
  const signature=rosterIndexSignature();
  if(state.rosterIndex?.signature===signature) return state.rosterIndex;
  const idx=emptyRosterIndex(signature), seenGlobal=new Map(), seenSourceTeam=new Map();
  // One centralized scan normalizes Control rows and precomputes team summaries/reps for O(1) lookups.
  controlRosterRows().forEach(r=>{
    const key=r._repKey, source=r.sourceArea||r.source||'', team=canonicalCoachName(r._team||r.team||''), teamKey=coachNameKey(team);
    if(!key||!team) return;
    const entry={kind:'rep',key,rosterId:r.rosterId,name:r._rep,displayName:r.displayName||r._rep,team,sourceArea:source,source,tabName:r.tabName||'',sheetName:r.sheetName||'',workbook:r.workbook||'',rowNumber:r.rowNumber||'',originalName:r.originalName||r.representative||'',_isControlRoster:r._isControlRoster!==false,_teamAssignedManually:!!r._teamAssignedManually};
    idx.rows.push(r); idx.byRosterId.set(r.rosterId,r);
    if(!idx.byRepKey.has(key)) idx.byRepKey.set(key,{team,name:r._rep,source,sourceArea:source,tabName:r.tabName||'',rosterId:r.rosterId,conflict:false}); else idx.byRepKey.get(key).conflict=true;
    const sr=sourceRepCompositeKey(source,key); if(!idx.bySourceRepKey.has(sr)) idx.bySourceRepKey.set(sr,entry); else idx.bySourceRepKey.get(sr).conflict=true;
    idx.byTeamKey.set(teamKey,team);
    if(!idx.repsByTeamKey.has(teamKey)) idx.repsByTeamKey.set(teamKey,new Map());
    idx.repsByTeamKey.get(teamKey).set(r.rosterId,entry);
    const stKey=`${source}\u0000${teamKey}\u0000${key}`;
    if(seenSourceTeam.has(stKey)) idx.conflicts.push({id:conflictId('duplicate-roster',stKey),type:'Duplicate roster names',status:'unresolved',originalName:r.originalName||r._rep,sourceCategory:source,sourceFile:r.workbook||'',possibleRepresentatives:[seenSourceTeam.get(stKey),entry],possibleTeams:[team],message:'Same normalized full name appears twice in one trusted roster team.'}); else seenSourceTeam.set(stKey,entry);
    if(seenGlobal.has(key)){ const prev=seenGlobal.get(key); if(prev.team!==team || prev.sourceArea!==source) idx.conflicts.push({id:conflictId('cross-roster',key),type:'Identity conflict',status:'unresolved',originalName:r._rep,sourceCategory:source,sourceFile:r.workbook||'',possibleRepresentatives:[prev,entry],possibleTeams:[prev.team,team],message:'Same normalized full name appears on multiple teams or sources.'}); } else seenGlobal.set(key,entry);
  });
  const conflictCounts=new Map(); idx.conflicts.forEach(c=>(c.possibleTeams||[]).forEach(t=>conflictCounts.set(coachNameKey(t),(conflictCounts.get(coachNameKey(t))||0)+1)));
  idx.repsByTeamKey.forEach((map,teamKey)=>{ const reps=[...map.values()], team=idx.byTeamKey.get(teamKey)||reps[0]?.team||''; idx.teamSummaries.set(teamKey,{team,teamKey,count:reps.length,originalControlCount:reps.filter(r=>r._isControlRoster!==false).length,sourceArea:reps[0]?.sourceArea||'',manualMoveCount:reps.filter(r=>r._teamAssignedManually).length,conflictCount:conflictCounts.get(teamKey)||0,quarantinedAliasCount:(ensureQuarantineIndex().byTeamKey.get(teamKey)||[]).length}); });
  state.identityConflicts=idx.conflicts; state.rosterIndex=idx; return idx;
}

function markDataIndexDirty(reason='data changed'){
  bumpVersion('data');
  if(/retail/i.test(reason)) bumpVersion('retail');
  if(/referral/i.test(reason)) bumpVersion('referral');
  if(/roster|team assignment|team|mapping/i.test(reason)) bumpVersion(/mapping/i.test(reason)?'mappings':'teams');
  invalidateRosterIndex(reason);
  if(!state.dataIndex) state.dataIndex={dirty:true,reason,sources:{},reps:[],teamCounts:[],repsByTeam:new Map(),dateRanges:{qa:{interaction:null,assigned:null},date:new Map(),checklist:new Map(),documented_coaching:new Map(),comp_calls:new Map()},version:0,lastBuiltAt:0};
  state.dataIndex.dirty=true;
  state.dataIndex.reason=reason;
  state.researchSourceIndexes=new Map();
  state.researchSourceIndexJobs=new Map();
  state.researchBuildingRowMeta=new WeakMap();
  if(state.researchEntityTable) state.researchEntityTable.signature='';
  selectiveResearchInvalidation({reason:'data changed',source:reason});
  state.indexes=null;
  state.teamIndexCache=null;
  state._controlRosterCache=null;
}
function sourceSkipsTeamBuild(source){
  if(TEAM_TOTAL_SOURCE_KEYS.includes(source)) return true;
  if(!source || isCategorizedSource(source)) return false;
  const cfg=getSourceSetting(activeModelForImport(),source);
  return !!cfg?.columns?.skipTeamBuild;
}
function rowSourceKey(row,fallback=''){ return row?._sourceKey || fallback || ''; }
function rowSkipsTeamBuild(row,fallback=''){ return sourceSkipsTeamBuild(rowSourceKey(row,fallback)); }
function researchTokenizeText(v){ return Array.from(new Set(normalizeResearchText(v).match(/[a-z0-9]+/g)||[])); }
function researchMonthBucket(ms){ if(!Number.isFinite(ms)) return ''; const d=new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function researchDayBucket(ms){ return Number.isFinite(ms) ? ymd(new Date(ms)) : ''; }
function sourceDescriptionHeaders(source){ const hs=getHeaders(source)||[]; return hs.filter(h=>/description|desc|note|comment|compliment|detail|summary|item|category|result/i.test(h)); }
function rowDateMillisForSource(source,row){
  if(source===DATED_SOURCE) return parseDateOnly(row.Date||row._date)?.getTime()||NaN;
  if(source===NONDATED_SOURCE) return NaN;
  if(source==='qa' || source===QA_DIRECT_SOURCE) return parseDateOnly(row._interactionDate||row._assignedDate||row._date)?.getTime()||NaN;
  if(isCustomSource(source)){ const c=customSource(source)||{}, cols=c.columns||{}; const d=parseDateOnly((cols.date&&row[cols.date])||row._date) || parseWeekLabel((cols.week&&row[cols.week])||row._week, cols.weekStart) || parseDateOnly(cols.month&&row[cols.month]); return d?.getTime()||NaN; }
  const h=sourceDateHeader(source,getHeaders(source)) || findHeader(getHeaders(source), source==='documented_coaching'?['Date','Coaching Date','Created Date','Completed Date','Documented Date']:checklistLikeDefaultDateHeaders(source));
  return h ? (parseDateOnly(row[h])?.getTime()||NaN) : (parseDateOnly(row._date)?.getTime()||NaN);
}
function makeResearchSourceIndex(source, rows){
  const headers=getHeaders(source)||[], descHeaders=source==='documented_coaching'?sourceDescriptionHeaders(source):headers;
  return {version:state.dataIndex?.version||0,rows,headers,descriptionHeaders:descHeaders,byRep:new Map(),byTeam:new Map(),byTeamKey:new Map(),byCoach:new Map(),byCoachKey:new Map(),bySourceName:new Map(),byCategory:new Map(),byDate:new Map(),byDateBucket:new Map(),byWeek:new Map(),byMonth:new Map(),byHeader:new Map(),byHeaderName:new Map(),byColumnValue:new Map(),byWord:new Map(),byRepWord:new Map(),byRepSortedDate:new Map(),byTeamSortedDate:new Map(),byRowId:new Map(),dateValues:[],dateSortedRows:[],searchText:new WeakMap(),tokens:new WeakMap(),rowMeta:new WeakMap(),lazyIndexes:new Map(),reps:new Map(),perf:{rowsIndexed:0,lazyBuilds:[]}};
}
function addResearchIndexedRow(idx,source,row,rowId){
  const key=row._repKey||'', team=rowTeam(row), coach=team, ms=rowDateMillisForSource(source,row), day=researchDayBucket(ms), month=researchMonthBucket(ms), week=Number.isFinite(ms)?ymd(startOfWeekDate(new Date(ms),'sunday')):'';
  state.researchBuildingRowMeta=state.researchBuildingRowMeta instanceof WeakMap?state.researchBuildingRowMeta:new WeakMap(); state.researchBuildingRowMeta.set(row,{source,rowId});
  idx.rowMeta.set(row,{rowId,source});
  const canonical=researchCanonicalEntityForRow(row,source,team);
  if(team && !row._team) row._team=team;
  pushMapArray(idx.byRep,key,row); pushMapArray(idx.byTeam,team,row); pushMapArray(idx.byCoach,coach,row);
  if(team) pushMapArray(idx.byTeamKey,normalizeIdentityName(team),row);
  if(coach) pushMapArray(idx.byCoachKey,normalizeIdentityName(coach),row);
  const sourceName=String(row.Source||row.source||row._source||source||'').trim(), categoryName=String(row.Category||row.category||row._category||row.Type||row.type||'').trim();
  if(sourceName) pushMapArray(idx.bySourceName,normalizeResearchText(sourceName),row);
  if(categoryName) pushMapArray(idx.byCategory,normalizeResearchText(categoryName),row);
  if(day) pushMapArray(idx.byDate,day,row); if(day) pushMapArray(idx.byDateBucket,day,row); if(week){ pushMapArray(idx.byDateBucket,week,row); pushMapArray(idx.byWeek,week,row); } if(month){ pushMapArray(idx.byDateBucket,month,row); pushMapArray(idx.byMonth,month,row); }
  idx.byRowId.set(rowId,row);
  if(Number.isFinite(ms)){ idx.dateValues[rowId]=ms; idx.dateSortedRows.push(row); }
  idx.rowMeta.set(row,{rowId,source,repKey:key,entityId:canonical.entityId,entityNumber:canonical.entityNumber,teamId:canonical.teamId,teamNumber:canonical.teamNumber,coachKey:nameKey(coach)||normalizeResearchText(coach),teamKey:normalizeResearchText(team),dateMs:ms});
  if(key && Number.isFinite(ms)) pushMapArray(idx.byRepSortedDate,key,row);
  if(team && Number.isFinite(ms)) pushMapArray(idx.byTeamSortedDate,team,row);
  if(key && row._rep){ const rep={kind:'rep',key,name:cleanName(row._rep),team}; idx.reps.set(key,mergeRepDisplay(idx.reps.get(key),rep)); }
  idx.perf.rowsIndexed++;
}
function researchEntityTableSignature(){
  const v=state.versions||{};
  return [RESEARCH_SOURCE_INDEX_SCHEMA_VERSION,v.roster||0,v.aliases||0,v.teams||0,v.mappings||0,controlRosterSignature()].join('|');
}
function researchStableEntityId(prefix,value){
  const text=String(value||'blank'); let h=2166136261;
  for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619); }
  return `${prefix}_${(h>>>0).toString(36)}`;
}
function ensureResearchCanonicalEntityTable(){
  const signature=researchEntityTableSignature();
  if(state.researchEntityTable?.signature===signature) return state.researchEntityTable;
  const table={signature,byRepKey:new Map(),byEntityId:new Map(),teamsById:new Map(),teamIdByKey:new Map(),nextRepId:1,nextTeamId:1};
  state.researchEntityTable=table;
  const teamFor=name=>{
    const display=canonicalCoachName(name)||String(name||'').trim(), key=coachNameKey(display)||normalizeIdentityName(display)||'(blank team)';
    let id=table.teamIdByKey.get(key);
    if(!id){ id=researchStableEntityId('team',key); table.teamIdByKey.set(key,id); table.teamsById.set(id,{teamId:id,teamNumber:table.nextTeamId++,key,name:display||'(blank team)',aliases:new Set(display?[display]:[])}); }
    return table.teamsById.get(id);
  };
  controlRosterRows().forEach(r=>{
    const repKey=r._repKey||nameKey(r._rep||''), team=teamFor(r._team||rowTeam(r));
    if(!repKey) return;
    const entityId=researchStableEntityId('rep',repKey), entity={entityId,entityNumber:table.nextRepId++,repKey,name:r._rep||displayIdentityName(repKey),teamId:team.teamId,teamNumber:team.teamNumber,team:team.name,aliases:new Set([r._rep,r.originalName,r.displayName].filter(Boolean)),sources:new Set(['control_roster'])};
    table.byRepKey.set(repKey,entity); table.byEntityId.set(entityId,entity);
  });
  return table;
}
function researchCanonicalEntityForRow(row,source,knownTeam=''){
  const table=ensureResearchCanonicalEntityTable(), rawTeam=knownTeam||rowTeam(row)||'', teamKey=coachNameKey(rawTeam)||normalizeIdentityName(rawTeam)||'(blank team)';
  let teamId=table.teamIdByKey.get(teamKey);
  if(!teamId){ teamId=researchStableEntityId('team',teamKey); table.teamIdByKey.set(teamKey,teamId); table.teamsById.set(teamId,{teamId,teamNumber:table.nextTeamId++,key:teamKey,name:canonicalCoachName(rawTeam)||rawTeam||'(blank team)',aliases:new Set(rawTeam?[rawTeam]:[])}); }
  const team=table.teamsById.get(teamId), rep=getRepIdentity(row,source), repKey=rep.normalizedName||row?._repKey||'';
  if(!repKey) return {entityId:'',entityNumber:0,teamId,teamNumber:team.teamNumber};
  let entity=table.byRepKey.get(repKey);
  if(!entity){
    const entityId=researchStableEntityId('rep',repKey);
    entity={entityId,entityNumber:table.nextRepId++,repKey,name:rep.displayName||rep.rawName||repKey,teamId,teamNumber:team.teamNumber,team:team.name,aliases:new Set(),sources:new Set()};
    table.byRepKey.set(repKey,entity); table.byEntityId.set(entityId,entity);
  }
  [rep.rawName,rep.displayName,row?._rep,row?.Representative,row?.['Agent Name'],row?.['Associate Name']].filter(Boolean).forEach(v=>entity.aliases.add(String(v)));
  entity.sources.add(source); if(!entity.teamId || entity.team==='(blank team)'){ entity.teamId=teamId; entity.teamNumber=team.teamNumber; entity.team=team.name; }
  return {entityId:entity.entityId,entityNumber:entity.entityNumber,teamId:entity.teamId||teamId,teamNumber:entity.teamNumber||team.teamNumber};
}
function finalizeResearchSourceIndex(idx,source){
  const count=idx?.rows?.length||0, entityNumbers=new Uint32Array(count), teamNumbers=new Uint32Array(count), dateValues=new Float64Array(count), allRowsBitset=new Uint32Array(Math.ceil(count/32));
  dateValues.fill(NaN);
  for(let i=0;i<count;i++){ const meta=idx.rowMeta.get(idx.rows[i])||{}; entityNumbers[i]=meta.entityNumber||0; teamNumbers[i]=meta.teamNumber||0; if(Number.isFinite(meta.dateMs)) dateValues[i]=meta.dateMs; allRowsBitset[i>>>5]|=1<<(i&31); }
  idx.compact={entityNumbers,teamNumbers,dateValues,allRowsBitset};
  idx.signature=researchSourceIndexSignature(source);
  return idx;
}
function researchSourceIndexSignature(source){
  const rows=getRowsRaw(source)||[], headers=getHeaders(source)||[], cs=isCustomSource(source)?customSource(source):null;
  const fileName=cs?.fileName || (source.startsWith('retail')?state.data.retail.fileName:source.startsWith('referral')?state.data.referral.fileName:(state.data[source]?.fileName||''));
  const sourceVersion=state.sourceMeta?.[source]?.sourceVersion||state.versions?.data||0;
  return [RESEARCH_SOURCE_INDEX_SCHEMA_VERSION,source,sourceVersion,rows.length,headers.join('\u001f'),fileName,state.versions?.aliases||0,state.versions?.teams||0,state.versions?.mappings||0].join('\u001e');
}
async function ensureResearchSourceIndex(source,opts={}){
  if(!source || isDynamicResearchSource(source)) return null;
  const global=dataIndexReady()?state.dataIndex.sources?.[source]:null;
  if(global){ if(!global.compact) finalizeResearchSourceIndex(global,source); return global; }
  state.researchSourceIndexes=state.researchSourceIndexes instanceof Map?state.researchSourceIndexes:new Map();
  state.researchSourceIndexJobs=state.researchSourceIndexJobs instanceof Map?state.researchSourceIndexJobs:new Map();
  const signature=researchSourceIndexSignature(source), cached=state.researchSourceIndexes.get(source);
  if(cached?.signature===signature) return cached;
  const active=state.researchSourceIndexJobs.get(source); if(active?.signature===signature) return active.promise;
  const promise=(async()=>{
    const rows=getRowsRaw(source)||[], idx=makeResearchSourceIndex(source,rows); idx.version=(state.dataIndex?.version||0)+1;
    idx.signature=signature;
    const chunk=Math.max(500,Number(opts.chunkSize)||1500), start=performance.now();
    for(let i=0;i<rows.length;i++){
      addResearchIndexedRow(idx,source,rows[i],i);
      if((i+1)%chunk===0){ if(opts.token?.cancelled) throw new Error('Research source preparation cancelled.'); if(opts.onProgress) opts.onProgress(source,i+1,rows.length); await yieldToBrowser(); }
    }
    idx.byRepSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.byTeamSortedDate.forEach(list=>list.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0)));
    idx.dateSortedRows.sort((a,b)=>(idx.rowMeta.get(a)?.dateMs||0)-(idx.rowMeta.get(b)?.dateMs||0));
    finalizeResearchSourceIndex(idx,source); idx.perf.prepareMs=Math.round(performance.now()-start);
    state.researchSourceIndexes.set(source,idx); return idx;
  })();
  state.researchSourceIndexJobs.set(source,{signature,promise});
  try{ return await promise; }catch(error){ const current=state.researchSourceIndexes.get(source); if(current?.signature===signature&&!current.compact) state.researchSourceIndexes.delete(source); throw error; }finally{ if(state.researchSourceIndexJobs.get(source)?.promise===promise) state.researchSourceIndexJobs.delete(source); }
}
function researchExecutionSources(item={}){
  item=effectiveResearchItem(normalizeResearchItem(item));
  const sources=new Set([item.source,...researchReferencedSources(item)]);
  const cols=expandedResearchColumns(item);
  cols.forEach(c=>{ const def=researchTypedMeasureDefinition(c.measureId||researchMeasureIdFromRef(c.field)); if(def){ const resolved=resolveResearchTypedMeasure(def,item.source); if(resolved?.source) sources.add(resolved.source); } });
  const graphDef=researchTypedMeasureDefinition(item.measureId||researchMeasureIdFromRef(item.valueField)); if(graphDef){ const resolved=resolveResearchTypedMeasure(graphDef,item.source); if(resolved?.source) sources.add(resolved.source); }
  return [...sources].filter(src=>src&&!isDynamicResearchSource(src)&&allSourceKeys().includes(src));
}
async function ensureResearchExecutionIndexes(item,opts={}){
  const sources=researchExecutionSources(item), timings={}, sourceDetails=[], started=performance.now(), totalRows=sources.reduce((n,source)=>n+(getRowsRaw(source)||[]).length,0)||1, rosterRows=(controlRosterRows()||[]).length; let completedRows=0;
  for(let i=0;i<sources.length;i++){
    const source=sources[i], sourceRows=(getRowsRaw(source)||[]).length, sourceStartRows=completedRows, reused=!!sourceIndex(source), t0=performance.now(), pctFor=done=>opts.start==null?null:opts.start+(opts.end-opts.start)*((sourceStartRows+Math.min(sourceRows,done||0))/totalRows);
    if(opts.progressToken&&pctFor(0)!=null) updateResearchProgress(opts.progressToken,`Used source ${i+1} of ${sources.length}: ${labelSource(source)} — ${sourceRows.toLocaleString()} imported rows${reused?' (index reused)':''}${i===0&&rosterRows?` · ${rosterRows.toLocaleString()} roster rows support identity matching`:''}`,pctFor(0),{force:true});
    await ensureResearchSourceIndex(source,{token:opts.token,onProgress:(src,done,total)=>{ const pct=pctFor(done); if(opts.progressToken&&pct!=null) updateResearchProgress(opts.progressToken,`Indexing used source ${i+1} of ${sources.length}: ${labelSource(src)} — ${done.toLocaleString()} / ${total.toLocaleString()} rows · ${(completedRows+done).toLocaleString()} / ${totalRows.toLocaleString()} across all used sources`,pct); }});
    timings[source]=Math.round(performance.now()-t0); completedRows+=sourceRows; sourceDetails.push({source,rows:sourceRows,reused,prepareMs:timings[source]});
    if(opts.progressToken&&pctFor(sourceRows)!=null) updateResearchProgress(opts.progressToken,`${i===sources.length-1?'All analytical sources ready':'Source ready: '+labelSource(source)} — ${completedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows across all used sources${i===sources.length-1&&rosterRows?` · ${rosterRows.toLocaleString()} roster rows available for identity matching`:''}`,pctFor(sourceRows),{force:true});
  }
  return {sources,sourceDetails,totalRows,timings,totalMs:Math.round(performance.now()-started)};
}
async function ensureResearchItemsExecutionIndexes(items,opts={}){
  const normalized=(items||[]).map(normalizeResearchItem), sources=[...new Set(normalized.flatMap(researchExecutionSources))], timings={}, sourceDetails=[], started=performance.now(), totalRows=sources.reduce((n,source)=>n+(getRowsRaw(source)||[]).length,0)||1, rosterRows=(controlRosterRows()||[]).length; let completedRows=0;
  for(let i=0;i<sources.length;i++){
    if(opts.token?.cancelled) break;
    const source=sources[i], sourceRows=(getRowsRaw(source)||[]).length, sourceStartRows=completedRows, reused=!!sourceIndex(source), t0=performance.now();
    const pctFor=done=>opts.start==null?null:opts.start+(opts.end-opts.start)*((sourceStartRows+Math.min(sourceRows,done||0))/totalRows);
    if(opts.progressToken&&pctFor(0)!=null) updateResearchProgress(opts.progressToken,`Used source ${i+1} of ${sources.length}: ${labelSource(source)} — ${sourceRows.toLocaleString()} imported rows${reused?' (index reused)':''}${i===0&&rosterRows?` · ${rosterRows.toLocaleString()} roster rows support identity matching`:''}`,pctFor(0),{force:true});
    else if(opts.showProgress&&pctFor(0)!=null) updateProgress(`Preparing ${labelSource(source)} — ${sourceRows.toLocaleString()} imported rows${reused?' (index reused)':''}`,pctFor(0));
    await ensureResearchSourceIndex(source,{token:opts.token,onProgress:(src,done,total)=>{
      const pct=pctFor(done);
      if(opts.progressToken&&pct!=null) updateResearchProgress(opts.progressToken,`Indexing used source ${i+1} of ${sources.length}: ${labelSource(src)} — ${done.toLocaleString()} / ${total.toLocaleString()} rows · ${(sourceStartRows+done).toLocaleString()} / ${totalRows.toLocaleString()} across all used sources`,pct);
      else if(opts.showProgress&&pct!=null) updateProgress(`Preparing ${labelSource(src)}...`,pct);
    }});
    timings[source]=Math.round(performance.now()-t0); completedRows+=sourceRows; sourceDetails.push({source,rows:sourceRows,reused,prepareMs:timings[source]});
    if(opts.progressToken&&pctFor(sourceRows)!=null) updateResearchProgress(opts.progressToken,`${i===sources.length-1?'All analytical sources ready':'Source ready: '+labelSource(source)} — ${completedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows across all used sources${i===sources.length-1&&rosterRows?` · ${rosterRows.toLocaleString()} roster rows available for identity matching`:''}`,pctFor(sourceRows),{force:true});
    else if(opts.showProgress&&pctFor(sourceRows)!=null) updateProgress(`${labelSource(source)} ready — ${completedRows.toLocaleString()} / ${totalRows.toLocaleString()} rows across all used sources`,pctFor(sourceRows));
  }
  return {sources,sourceDetails,totalRows,timings,totalMs:Math.round(performance.now()-started)};
}
function sourceIndex(source){
  if(dataIndexReady()) return state.dataIndex.sources[source] || null;
  const scoped=state.researchSourceIndexes instanceof Map?state.researchSourceIndexes.get(source):null;
  if(scoped) return scoped;
  const runIdx=state.runIndexes instanceof Map ? state.runIndexes.get(source) : null;
  if(runIdx) return runIdx;
  return state.indexes?.[source] || null;
}
function cachedRowsForSource(source, opts={}){
  if(!opts || !opts._sourceRowsCache) return getRows(source, opts);
  const key=rowsCacheKey(source, opts);
  if(opts._sourceRowsCache.has(key)){ state.perfCounters.sourceRowCacheHits=(state.perfCounters.sourceRowCacheHits||0)+1; return opts._sourceRowsCache.get(key); }
  state.perfCounters.sourceRowCacheMisses=(state.perfCounters.sourceRowCacheMisses||0)+1;
  if(!opts._sourceRowsCache.has(key)){
    const idx=sourceIndex(source);
    const base=idx ? idx.rows : getRowsRaw(source);
    opts._sourceRowsCache.set(key, filterRowsForSource(source, base, opts));
  }
  return opts._sourceRowsCache.get(key);
}
function cachedRowsForEntry(source, entry, opts={}){
  if(!opts || !opts._entryRowsCache) return null;
  const sourceKey=rowsCacheKey(source, opts);
  const entryKey=entry.kind==='team' ? `team:${coachNameKey(entry.name)}` : `rep:${entry.key}`;
  const key=sourceKey+'|'+entryKey;
  if(opts._entryRowsCache.has(key)){ state.perfCounters.entryRowCacheHits=(state.perfCounters.entryRowCacheHits||0)+1; return opts._entryRowsCache.get(key); }
  state.perfCounters.entryRowCacheMisses=(state.perfCounters.entryRowCacheMisses||0)+1;
  const idx=sourceIndex(source);
  let rows;
  if(idx){
    let raw = entry.kind==='team' ? (idx.byTeam.get(entry.name)||[]) : (idx.byRep.get(entry.key)||[]);
    if(entry.kind==='team' && !raw.length){
      raw = idx.byTeamKey.get(normalizeIdentityName(entry.name)) || [];
      if(!raw.length){
        for(const [candidate,list] of idx.byTeam.entries()){
          if(coachNameKey(candidate)===coachNameKey(entry.name)){ raw=list||[]; break; }
        }
      }
    }
    rows = filterRowsForSource(source, raw, opts);
  }else{
    rows=cachedRowsForSource(source, opts);
    if(entry.kind==='team') rows=rows.filter(r=>coachNameKey(rowTeam(r)||state.repTeams.get(r._repKey)||'')===coachNameKey(entry.name));
    else rows=rows.filter(r=>r._repKey===entry.key && rowMatchesTrustedEntry(r,entry,source));
  }
  opts._entryRowsCache.set(key, rows);
  return rows;
}
function sourceOptions(selected){
  return allSourceKeys().map(v=>`<option value="${v}" ${v===selected?'selected':''}>${labelSource(v)}</option>`).join('');
}
function displayColumnSourceOptions(c){
  return allSourceKeys().map(v=>`<option value="${v}" ${v===c?.source?'selected':''}>${labelSource(v)}</option>`).join('');
}
function labelSource(v){return customSource(v)?.name || SOURCE_LABELS[v]||v;}
function headerOptions(source, selected, blank=true){
  const selectedName=plainHeaderName(selected);
  const names=[]; const seen=new Set();
  if(selectedName){ names.push(selectedName); seen.add(selectedName); }
  (getHeaders(source)||[]).forEach(x=>{ x=plainHeaderName(x); if(x && !seen.has(x)){ names.push(x); seen.add(x); } });
  return `${blank?'<option value=""></option>':''}${names.map(x=>`<option value="${esc(x)}" ${x===selectedName?'selected':''}>${esc(x)}</option>`).join('')}`;
}
function sourceHeaderSelectHtml(source, selected, attr, blank=true){
  return `<select ${attr||''}>${headerOptions(source, selected, blank)}</select>`;
}
function uniqueValues(source, column){
  if(!source||!column) return [];
  const rows=getRows(source,{});
  return Array.from(new Set(rows.map(r=>String(r[column]??'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
}
function renderModelList(){
  if(!els.modelList) return;
  if(!state.models.length){ els.modelList.innerHTML=''; return; }
  els.modelList.innerHTML = state.models.map(m=>`<div class="modelRow"><div class="row"><strong>${esc(m.name)}</strong><span class="badge">${esc(m.type||'both')}</span><span class="badge">${(m.criteria||[]).length}</span><span style="flex:1"></span><button class="smallBtn dark" data-export-model="${m.id}">Export</button><button class="smallBtn" data-modify-model="${m.id}">Modify</button><button class="smallBtn red" data-delete-model="${m.id}">Delete</button></div></div>`).join('');
  els.modelList.querySelectorAll('[data-modify-model]').forEach(b=>b.onclick=()=>openEditModel(b.dataset.modifyModel));
  els.modelList.querySelectorAll('[data-delete-model]').forEach(b=>b.onclick=()=>deleteModel(b.dataset.deleteModel));
  els.modelList.querySelectorAll('[data-export-model]').forEach(b=>b.onclick=()=>{const m=normalizeModelForStorage(findModel(b.dataset.exportModel)); downloadText(`${m.name.replace(/[^a-z0-9]+/gi,'_')}.txt`, serializeModelsForExport([m]));});
}
function findModel(mid){return state.models.find(m=>m.id===mid);}
function deleteModel(mid){
  const m=findModel(mid); if(!m) return;
  if(confirm(`Delete model "${m.name}"?`)){ state.models=state.models.filter(x=>x.id!==mid); saveModels(); }
}
function openEditModel(mid){
  const m=mid?JSON.parse(JSON.stringify(findModel(mid))):{id:id(),name:'New Model',type:'both',tiebreaker:'overallScore',criteria:[]};
  state.editModel=m; state.editOriginalId=mid||null;
  els.editModelTitle.textContent = mid?'Modify Model':'Create Model';
  renderEditModel(); openModal('editModelModal');
}
function renderEditModel(){
  const m=state.editModel; if(!m) return;
  ensureSourceSettings(m);
  els.modelNameInput.value=m.name||'';
  els.modelTypeInput.value=m.type||'both';
  els.modelTiebreakerInput.innerHTML = `<option value="overallScore">Overall Score</option>${(m.criteria||[]).map(c=>`<option value="${c.id}" ${m.tiebreaker===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}`;
  els.modelTiebreakerInput.value=m.tiebreaker||'overallScore';
  if(els.sourceSettingsPanel) els.sourceSettingsPanel.innerHTML = modelSourceSettingsHtml(m);
  if(els.columnCheckResults) els.columnCheckResults.innerHTML = '';
  els.criteriaList.innerHTML = (m.criteria||[]).map((c,i)=>criterionHtml(c,i)).join('');
  bindModelSourceSettings();
  bindCriteriaEditors();
}

function customMappingFieldsHtml(source, cols={}, fw='generic_table', headerOverride=null){
  const optionHtml=(selected)=>{
    if(!Array.isArray(headerOverride)) return sourceHeaderSelectHtml(source, selected, '', true).replace('<select >','<select>');
    const selectedName=plainHeaderName(selected), names=[], seen=new Set();
    if(selectedName){ names.push(selectedName); seen.add(selectedName); }
    headerOverride.forEach(h=>{ h=plainHeaderName(h); if(h && !seen.has(h)){ names.push(h); seen.add(h); } });
    return `<select><option value=""></option>${names.map(h=>`<option value="${esc(h)}" ${h===selectedName?'selected':''}>${esc(h)}</option>`).join('')}</select>`;
  };
  return relevantMappingKeys(source,fw).map(key=>{ const attr=`data-qacol-source="${source}" data-qacol-field="${key}"`; return `<div class="field"><label>${esc(SOURCE_MAPPING_LABELS[key]||key)}</label>${optionHtml(cols[key]||'').replace('<select',`<select ${attr}`)}</div>`; }).join('');
}
function renderTroubleCustomFrameworkPanel(headers=[]){
  const box=els.troubleCustomFrameworkPanel; if(!box) return;
  const src=state.troubleshoot.source;
  if(!isCustomSource(src)){ box.classList.add('hidden'); box.innerHTML=''; return; }
  const cfg=getSourceSetting(activeModelForImport(),src), cols=cfg.columns||{}, fw=cfg.framework||sourceFramework(src)||'generic_table';
  box.classList.remove('hidden');
  box.innerHTML=`<div class="panelTitle">Source Framework + Standard Column Mapping</div><div class="field"><label>Source Framework</label><select id="troubleSourceFramework">${sourceFrameworkOptions(fw)}</select><div class="checkResultMeta">${esc(frameworkDef(fw).help)}</div></div><div class="qaGrid">${customMappingFieldsHtml(src, cols, fw, headers)}${fw==='weekly_stat_file'?`<div class="field"><label>File row grain</label><select data-qacol-source="${src}" data-qacol-field="statPeriod"><option value="week" ${cols.statPeriod==='week'?'selected':''}>one row per rep per week</option><option value="day" ${cols.statPeriod==='day'?'selected':''}>one row per rep per day</option><option value="month" ${cols.statPeriod==='month'?'selected':''}>one row per rep per month</option><option value="period" ${cols.statPeriod==='period'?'selected':''}>one row per rep per stat period</option></select></div><div class="field"><label>Week start day</label><select data-qacol-source="${src}" data-qacol-field="weekStart"><option value="sunday" ${cols.weekStart!=='monday'?'selected':''}>Sunday</option><option value="monday" ${cols.weekStart==='monday'?'selected':''}>Monday</option></select></div><div class="field"><label>Date basis</label><select data-qacol-source="${src}" data-qacol-field="dateBasis"><option value="date" ${cols.dateBasis!=='week'?'selected':''}>Prefer mapped date column</option><option value="week" ${cols.dateBasis==='week'?'selected':''}>Use mapped week column</option></select></div>`:''}</div>`;
  const sel=box.querySelector('#troubleSourceFramework'); if(sel) sel.onchange=()=>{ updateAllModelsForSource(src,cfg=>{ cfg.framework=sel.value; }); const c=customSource(src); if(c) c.framework=sel.value; renderTroubleCustomFrameworkPanel(headers); };
  box.querySelectorAll('[data-qacol-source]').forEach(input=>input.onchange=()=>{ updateAllModelsForSource(src,cfg=>{ cfg.columns=cfg.columns||{}; cfg.columns[input.dataset.qacolField]=input.value.trim(); }); });
}
function sourceSettingCard(source, cfg){
  const cols=cfg.columns||{};
  const sourceHeaders=getHeaders(source)||[];
  const sheetBadge=cfg.sheetName ? `Sheet: ${esc(cfg.sheetName)}` : 'Sheet: auto';
  const layoutHtml = `<div class="miniGrid">
      <div class="field"><label>Header Row</label><input type="number" min="1" step="1" data-layout-source="${source}" data-layout-field="headerRow" value="${esc(cfg.headerRow||1)}"></div>
      <div class="field"><label>Start Column</label><input type="number" min="1" step="1" data-layout-source="${source}" data-layout-field="startCol" value="${esc(cfg.startCol||1)}"></div>
    </div>`;
  const trustHtml=`<label class="checkItem"><input type="checkbox" data-qacol-source="${source}" data-qacol-field="skipTeamBuild" ${cols.skipTeamBuild?'checked':''}> Do not build teams from this file</label><div class="hint">Rep rows still match by normalized name and inherit coach/team from trusted files.</div>`;
  let extra='';
  if(source==='qa'){
    extra = `<div class="qaGrid">
      <div class="field"><label>Representative Column</label>${sourceHeaderSelectHtml('qa', cols.agent||'Agent Name', 'data-qacol-source="qa" data-qacol-field="agent"')}</div>
      <div class="field"><label>Coach / Team Column</label>${sourceHeaderSelectHtml('qa', cols.team||'Team', 'data-qacol-source="qa" data-qacol-field="team"')}</div>
      <div class="field"><label>Score Average Column</label>${sourceHeaderSelectHtml('qa', cols.score||'Score %', 'data-qacol-source="qa" data-qacol-field="score"')}</div>
      <div class="field"><label>Interaction Date Column</label>${sourceHeaderSelectHtml('qa', cols.interactionDate||'Interaction Start Time', 'data-qacol-source="qa" data-qacol-field="interactionDate"')}</div>
      <div class="field"><label>Assigned Date Column</label>${sourceHeaderSelectHtml('qa', cols.assignedDate||'Assigned Date', 'data-qacol-source="qa" data-qacol-field="assignedDate"')}</div>
    </div>`;
  }else if(isCustomSource(source)){
    const fw=cfg.framework||sourceFramework(source)||'generic_table';
    extra = `<div class="qaGrid">
      <div class="field"><label>Source Framework</label><select data-framework-source="${source}">${sourceFrameworkOptions(fw)}</select><div class="hint">${esc(frameworkDef(fw).help)}</div></div>
      ${customMappingFieldsHtml(source, cols, fw)}
      ${fw==='weekly_stat_file'?`<div class="field"><label>File row grain</label><select data-qacol-source="${source}" data-qacol-field="statPeriod"><option value="week" ${cols.statPeriod==='week'?'selected':''}>one row per rep per week</option><option value="day" ${cols.statPeriod==='day'?'selected':''}>one row per rep per day</option><option value="month" ${cols.statPeriod==='month'?'selected':''}>one row per rep per month</option><option value="period" ${cols.statPeriod==='period'?'selected':''}>one row per rep per stat period</option></select></div><div class="field"><label>Week start day</label><select data-qacol-source="${source}" data-qacol-field="weekStart"><option value="sunday" ${cols.weekStart!=='monday'?'selected':''}>Sunday</option><option value="monday" ${cols.weekStart==='monday'?'selected':''}>Monday</option></select></div><div class="field"><label>Date basis</label><select data-qacol-source="${source}" data-qacol-field="dateBasis"><option value="date" ${cols.dateBasis!=='week'?'selected':''}>Prefer mapped date column</option><option value="week" ${cols.dateBasis==='week'?'selected':''}>Use mapped week column</option></select></div>`:''}
    </div>`;
  }else if(isChecklistLikeSource(source)){
    const baseCols=SOURCE_SETTING_DEFAULTS[source]?.columns || SOURCE_SETTING_DEFAULTS.checklist.columns || {};
    extra = `<div class="qaGrid">
      <div class="field"><label>Representative Column</label>${sourceHeaderSelectHtml(source, cols.rep||baseCols.rep||baseCols.fullName||'Associate Name', `data-qacol-source="${source}" data-qacol-field="rep"`)}</div>
      <div class="field"><label>Coach Assigned Column</label>${sourceHeaderSelectHtml(source, cols.team||baseCols.team||'Coach Assigned', `data-qacol-source="${source}" data-qacol-field="team"`)}</div>
    </div>`;
  }
  return `<div class="sourceCard"><div class="sourceCardTitle"><span>${esc(labelSource(source))}</span><span class="badge">${sheetBadge}</span></div>${layoutHtml}${trustHtml}${extra}<div class="checkResultMeta">${sourceHeaders.length?`${sourceHeaders.length} headers loaded`:'No headers loaded yet'}</div></div>`;
}
function modelSourceSettingsHtml(model){
  const settings=ensureSourceSettings(model);
  const cards=[...Object.keys(SOURCE_SETTING_DEFAULTS), ...customSourceKeys()].map(src=>sourceSettingCard(src, settings[src]||customSourceDefaultSettings(src))).join('');
  return `<div class="row"><strong>Model Source / Column Expectations</strong><button id="runColumnCheckBtn" class="dark" type="button">Run Column Check / Apply Layout</button><span class="sourceHelp">These settings are saved with this model and export/import with it. Row and column numbers are 1-based.</span></div><div class="sourceGrid">${cards}</div>`;
}
function bindModelSourceSettings(){
  if(!state.editModel || !els.sourceSettingsPanel) return;
  ensureSourceSettings(state.editModel);
  els.sourceSettingsPanel.querySelectorAll('[data-layout-source]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const src=input.dataset.layoutSource, field=input.dataset.layoutField;
      state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||sourceDefaults(src);
      state.editModel.sourceSettings[src][field]=Math.max(1,Number(input.value)||1);
    };
  });
  els.sourceSettingsPanel.querySelectorAll('[data-framework-source]').forEach(input=>{
    input.onchange=()=>{ const src=input.dataset.frameworkSource; state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||customSourceDefaultSettings(src); state.editModel.sourceSettings[src].framework=input.value; const c=customSource(src); if(c) c.framework=input.value; renderEditModel(); };
  });
  els.sourceSettingsPanel.querySelectorAll('[data-qacol-source]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const src=input.dataset.qacolSource, field=input.dataset.qacolField;
      state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||sourceDefaults(src);
      state.editModel.sourceSettings[src].columns=state.editModel.sourceSettings[src].columns||{};
      state.editModel.sourceSettings[src].columns[field]=input.type==='checkbox' ? input.checked : input.value.trim();
    };
  });
  const btn=el('runColumnCheckBtn');
  if(btn) btn.onclick=()=>runModelColumnCheck();
}
function splitExpressionColumns(expr){
  const out=[]; String(expr||'').replace(/(^|[^!])\[([^\]]+)\](?!\s*\.\s*\[)/g,(m,prefix,col)=>{out.push(col); return m;}); return out;
}
function normalizeSourceLookupText(v){ return String(v||'').toLowerCase().replace(/[\s._-]+/g,'').replace(/[^a-z0-9]/g,''); }
function sourceLookupNames(src){
  const names=[src,labelSource(src)];
  if(src===NONDATED_SOURCE) names.push('nondate','non-date','non date','nondated','non-dated','non dated','nondate database','nondated database','non-date database');
  if(src===DATED_SOURCE) names.push('date','dated','date database','dated database');
  return [...new Set(names.map(x=>String(x||'').trim()).filter(Boolean))];
}
function sourceKeyFromExpressionLabel(label){
  const wanted=norm(label), compact=normalizeSourceLookupText(label);
  return allSourceKeys().find(src=>sourceLookupNames(src).some(name=>norm(name)===wanted || normalizeSourceLookupText(name)===compact)) || '';
}
function splitSourceQualifiedLooseRef(body){
  const clean=String(body||'').trim();
  let best=null;
  allSourceKeys().forEach(src=>{
    sourceLookupNames(src).forEach(name=>{
      const n=String(name).trim(); if(!n) return;
      const variants=[n,n.replace(/[\s_-]+/g,'.'),n.replace(/[._-]+/g,' '),normalizeSourceLookupText(n)];
      variants.forEach(v=>{
        const low=clean.toLowerCase(), vl=String(v||'').toLowerCase();
        if(!vl) return;
        if(low.startsWith(vl+'.') || low.startsWith(vl+':')){
          const rawField=clean.slice(v.length+1).trim();
          if(rawField && (!best || v.length>best.rawSource.length)) best={rawSource:clean.slice(0,v.length),rawField};
        }
      });
    });
  });
  return best;
}
function researchLooseSourceReferencePairs(){
  const sources=allSourceKeys(), signature=[state.versions?.data||0,state.versions?.mappings||0,state.versions?.aliases||0,sources.join('\u001f')].join('\u001e');
  if(state.researchLooseSourceReferenceCache?.signature===signature) return state.researchLooseSourceReferenceCache.pairs;
  const pairs=[];
  sources.forEach(source=>{
    const sourceAliases=[...new Set(sourceLookupNames(source).flatMap(name=>[name,String(name).replace(/[\s_-]+/g,'.'),String(name).replace(/[._-]+/g,' '),normalizeSourceLookupText(name)]).map(x=>String(x||'').trim()).filter(Boolean))];
    const fields=(getHeaders(source)||[]).map(field=>({field,aliases:[...new Set([field,String(field).replace(/[\s_-]+/g,'.'),String(field).replace(/[._-]+/g,' '),normalizeSourceLookupText(field)].map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>b.length-a.length)}));
    sourceAliases.forEach(sourceAlias=>pairs.push({source,sourceAlias,fields}));
  });
  pairs.sort((a,b)=>b.sourceAlias.length-a.sourceAlias.length);
  state.researchLooseSourceReferenceCache={signature,pairs,normalized:new Map()};
  return pairs;
}
function normalizeResearchLooseSourceReferences(expression){
  let out=String(expression||''); if(!/[.:]/.test(out)) return out;
  const pairs=researchLooseSourceReferencePairs(), cache=state.researchLooseSourceReferenceCache?.normalized;
  if(cache?.has(out)) return cache.get(out);
  const original=out;
  pairs.forEach(({source,sourceAlias,fields})=>{
    const sourceProbe=new RegExp(`(^|[^!A-Za-z0-9_\\]])${escapeResearchRegex(sourceAlias)}\\s*[.:]`,'i');
    if(!sourceProbe.test(out)) return;
    fields.forEach(({field,aliases})=>aliases.forEach(fieldAlias=>{
      const rx=new RegExp(`(^|[^!A-Za-z0-9_\\]])${escapeResearchRegex(sourceAlias)}\\s*[.:]\\s*${escapeResearchRegex(fieldAlias)}(?=$|[^A-Za-z0-9_])`,'gi');
      out=out.replace(rx,(match,prefix)=>`${prefix}![${source}].[${field}]`);
    }));
  });
  if(cache) boundedMapSet(cache,original,out,300);
  return out;
}
function stripResearchRefBrackets(v){ return String(v||'').trim().replace(/^\[|\]$/g,'').trim(); }
function sourceQualifiedRefWarning(ref){
  if(!ref) return '';
  if(ref.missingSource) return `Missing source: ${ref.rawSource}`;
  if(ref.missingField) return `Missing header in ${labelSource(ref.source)||ref.rawSource}: ${ref.rawField}`;
  return '';
}
function addSourceQualifiedRefWarning(warnings,ref){
  const msg=sourceQualifiedRefWarning(ref);
  if(msg) researchExpressionAddWarning ? researchExpressionAddWarning(warnings||[],msg) : (warnings && !warnings.includes(msg) && warnings.push(msg));
  return msg;
}
function parseResearchSourceFieldRef(raw){
  const text=String(raw||'').trim();
  if(!text.startsWith('!')) return null;
  let m=text.match(/^!\s*\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]\s*$/);
  let loose=null;
  if(!m){ loose=splitSourceQualifiedLooseRef(text.replace(/^!\s*/,'')); if(loose) m=[text,loose.rawSource,loose.rawField]; }
  if(!m) m=text.match(/^!\s*([^:.]+?)\s*[:.]\s*(.+?)\s*$/);
  if(!m) return null;
  const rawSource=stripResearchRefBrackets(m[1]), rawField=stripResearchRefBrackets(m[2]);
  const source=sourceKeyFromExpressionLabel(rawSource);
  if(!source) return {source:'',field:'',rawSource,rawField,missingSource:true,missingField:false};
  const field=resolveColumn(source,rawField);
  const found=field && (getHeaders(source)||[]).some(h=>h===field || norm(h)===norm(field));
  return {source,field:found?field:'',rawSource,rawField,missingSource:false,missingField:!found};
}
function replaceResearchSourceFieldRefs(expr, replacer){
  let out=String(expr||'');
  out=out.replace(/!\s*\[([^\]]+)\]\s*\.\s*\[([^\]]+)\]/g,(m)=>replacer(m,parseResearchSourceFieldRef(m)));
  out=out.replace(/!\s*([^!()[\]+\-*/,\n\r]+?)\s*[:.]\s*([^!()[\]+\-*/,\n\r]+?)(?=$|[\s()[\]+\-*/,])/g,(m)=>replacer(m,parseResearchSourceFieldRef(m)));
  return out;
}
function splitCrossExpressionRefs(expr){
  const out=[];
  replaceResearchSourceFieldRefs(expr,(m,ref)=>{ out.push({sourceLabel:ref?.rawSource||'',source:ref?.source||'',column:ref?.rawField||'',field:ref?.field||'',missingSource:!!ref?.missingSource,missingField:!!ref?.missingField,cross:true}); return m; });
  return out;
}
function expressionRefsForSource(expr, defaultSource){
  const refs=[];
  expr=normalizeResearchLooseSourceReferences(expr);
  splitExpressionColumns(expr).forEach(col=>refs.push({source:defaultSource,column:col,cross:false}));
  splitCrossExpressionRefs(expr).forEach(ref=>refs.push({...ref,cross:true}));
  return refs;
}
function researchExpressionFieldRefs(expr, defaultSource){
  const refs=[], seen=new Set(), rawExpr=normalizeResearchLooseSourceReferences(String(expr||''));
  const sourceList=()=>allSourceKeys().filter(src=>!isDynamicResearchSource(src));
  const add=(source, rawField, extra={})=>{
    rawField=stripResearchRefBrackets ? stripResearchRefBrackets(rawField) : String(rawField||'').trim();
    source=source || defaultSource || '';
    if(!rawField) return;
    let resolved='', missingSource=false, missingField=false, rawSource=extra.rawSource||'';
    if(source && !isDynamicResearchSource(source)){
      resolved=resolveColumn(source,rawField)||'';
      missingField=!!source && !resolved;
    }else{
      const inferred=researchUniqueSourceForHeader(rawField,defaultSource||'') || researchBestSourceForHeader(rawField,defaultSource||'',[],{source:defaultSource||''});
      if(inferred){ source=inferred.source; resolved=inferred.field; }
      else resolved=rawField;
    }
    if(extra.missingSource) missingSource=true;
    if(extra.missingField) missingField=true;
    const key=[source||'',resolved||rawField,rawSource,missingSource,missingField].join('\u0000');
    if(seen.has(key)) return; seen.add(key);
    refs.push({source,field:resolved||rawField,column:rawField,rawField,rawSource,missingSource,missingField,cross:!!extra.cross,kind:extra.kind||'field'});
  };

  splitCrossExpressionRefs(rawExpr).forEach(ref=>add(ref.source,ref.field||ref.column||ref.rawField,{...ref,cross:true,kind:'sourceField'}));
  splitExpressionColumns(rawExpr).forEach(col=>add(defaultSource,col,{kind:'bracket'}));
  rawExpr.replace(/row\s*\[\s*['"]([^'"]+)['"]\s*\]/gi,(_,col)=>add(defaultSource,col,{kind:'row'}));
  rawExpr.replace(/\b(?:sum|avg|count|unique|min|max)\s*\(\s*['"]([^'"]+)['"]\s*\)/gi,(_,col)=>add(defaultSource,col,{kind:'aggregate'}));

  const metricNames=[...(state.metrics||[])].filter(Boolean);
  rawExpr.replace(/@([A-Za-z0-9 _.-]+)/g,(_,name)=>{
    const metric=findMetricByNameOrId(name) || findMetricByRef('@'+name) || findMetricByRef(name);
    if(metric){
      const src=metric.source||defaultSource||'';
      add(src,metric.field,{kind:'metric'});
      add(src,metric.percentOfField,{kind:'metric'});
      add(src,metric.withinCompareField,{kind:'metric'});
      (metric.rules||[]).forEach(r=>add(src,r.field,{kind:'metricRule'}));
    }
  });
  metricNames.forEach(metric=>{
    const name=metric.name||metric.id; if(!name) return;
    const rx=new RegExp(`(^|[^A-Za-z0-9_@])(${escapeResearchRegex(name)})(?=$|[^A-Za-z0-9_])`,'i');
    if(rx.test(rawExpr)){
      const src=metric.source||defaultSource||'';
      add(src,metric.field,{kind:'metric'});
      add(src,metric.percentOfField,{kind:'metric'});
      add(src,metric.withinCompareField,{kind:'metric'});
      (metric.rules||[]).forEach(r=>add(src,r.field,{kind:'metricRule'}));
    }
  });

  const candidates=[];
  const pushHeader=(src,h)=>{ if(h) candidates.push({source:src,field:h}); };
  if(defaultSource && !isDynamicResearchSource(defaultSource)) getResearchHeaders(defaultSource).forEach(h=>pushHeader(defaultSource,h));
  sourceList().forEach(src=>{ if(src!==defaultSource) getResearchHeaders(src).forEach(h=>pushHeader(src,h)); });
  candidates.sort((a,b)=>String(b.field).length-String(a.field).length);
  const masked=rawExpr
    .replace(/!\s*\[[^\]]+\]\s*\.\s*\[[^\]]+\]/g,' ')
    .replace(/!\s*[^!()[\]+\-*/,\n\r]+?\s*[:.]\s*[^!()[\]+\-*/,\n\r]+?(?=$|[\s()[\]+\-*/,])/g,' ')
    .replace(/\[[^\]]+\]/g,' ')
    .replace(/row\s*\[\s*['"][^'"]+['"]\s*\]/gi,' ');
  candidates.forEach(({source,field})=>{
    if(!field || /^(row|Math|sum|avg|count|unique|min|max|model|toNumber|inOrg)$/i.test(field)) return;
    const rx=new RegExp(`(^|[^A-Za-z0-9_])${escapeResearchRegex(field)}(?=$|[^A-Za-z0-9_])`,'i');
    if(rx.test(masked)) add(source,field,{kind:'bare'});
  });
  return refs;
}
function addRequired(map, source, label, expected){
  expected=plainHeaderName(expected); if(!source||!expected) return;
  if(!map.has(source)) map.set(source,[]);
  const arr=map.get(source);
  if(!arr.some(x=>norm(x.expected)===norm(expected) && x.label===label)) arr.push({label,expected});
}
function sourcesUsedByModel(model){
  const used=new Set();
  (model?.criteria||[]).forEach(c=>{
    ['source','leftSource','rightSource','customSource','trueValueSource'].forEach(f=>{ if(c[f]) used.add(c[f]); });
  });
  return Array.from(used);
}
function requiredColumnsForModel(model){
  ensureSourceSettings(model);
  const req=new Map();
  const used=new Set(sourcesUsedByModel(model));
  (model.criteria||[]).forEach(c=>{
    if(c.calcType==='single' || c.calcType==='displayColumn'){
      if(c.calcType==='displayColumn'){
        addRequired(req,c.source,`${c.name} match column`,c.lookupMatchColumn);
        if(c.displayCalculation!=='count') addRequired(req,c.source,`${c.name} return column`,c.lookupReturnColumn||c.column);
        if(['latest','earliest'].includes(c.lookupSelection)) addRequired(req,c.source,`${c.name} record date column`,c.lookupDateColumn);
      }else addRequired(req,c.source,`${c.name} column`,c.column);
      if(c.calcType==='single' && ['dateWithin','dateWithinPercent','valueWithin','valueWithinPercent'].includes(c.aggregate)) addRequired(req,c.source,`${c.name} compare column`,c.withinCompareColumn);
    }
    if(c.calcType==='multi'){
      addRequired(req,c.leftSource,`${c.name} left column`,c.leftColumn);
      addRequired(req,c.rightSource,`${c.name} right column`,c.rightColumn);
    }
    if(c.calcType==='custom') expressionRefsForSource(c.expression,c.customSource||c.source).forEach(ref=>addRequired(req,ref.source||ref.sourceLabel,`${c.name} expression`,ref.column));
    if(isRowPullCriterion(c)){
      const checkSrc=rowPullSourceForCriterion(c);
      addRequired(req,checkSrc,`${c.name} ${labelSource(checkSrc)} date`,c.checkDateColumn);
      ensureRowPullConditions(c).forEach((cond,idx)=>{
        addRequired(req,checkSrc,`${c.name} ${labelSource(checkSrc)} condition ${idx+1} column`,cond.column||c.checkColumn);
        if(cond.connector==='andSeparate') addRequired(req,checkSrc,`${c.name} ${labelSource(checkSrc)} condition ${idx+1} date`,cond.dateColumn||c.checkDateColumn);
      });
    }
    if(c.trueValueEnabled) addRequired(req,c.trueValueSource,`${c.name} true value column`,c.trueValueColumn);
    (c.filters||[]).forEach(f=>{
      if(f.dynamicColumn && isNumericFilterOperator(f.operator)) expressionRefsForSource(f.columnExpression,f.source||c.source).forEach(ref=>addRequired(req,ref.source||ref.sourceLabel,`${c.name} dynamic filter column`,ref.column));
      else addRequired(req,f.source||c.source,`${c.name} filter`,f.column);
      if(f.dynamic && isNumericFilterOperator(f.operator)) expressionRefsForSource(f.expression,f.source||c.source).forEach(ref=>addRequired(req,ref.source||ref.sourceLabel,`${c.name} dynamic filter value`,ref.column));
      if(['includeWithin','excludeWithin'].includes(f.action||f.mode)){
        addRequired(req,f.targetSource||'qa',`${c.name} target date-aware filter date`,f.targetDateColumn);
        addRequired(req,f.targetSource||'qa',`${c.name} target date-aware filter value`,f.targetValueColumn);
      }
    });
  });
  if(used.has('qa') || modelUsesQA(model)){
    const q=getSourceSetting(model,'qa').columns||{};
    if(q.nameMode==='firstLast'){
      addRequired(req,'qa','QA representative first name',q.firstName||'First Name');
      addRequired(req,'qa','QA representative last name',q.lastName||'Last Name');
    }else{
      addRequired(req,'qa','QA representative',q.fullName||q.agent||'Agent Name');
    }
    addRequired(req,'qa','QA coach/team',q.team||'Team');
    addRequired(req,'qa','QA score average',q.score||'Score %');
    addRequired(req,'qa','QA interaction date',q.interactionDate||'Interaction Start Time');
    addRequired(req,'qa','QA assigned date',q.assignedDate||'Assigned Date');
  }
  ['checklist','documented_coaching','comp_calls'].forEach(src=>{ if(!used.has(src)) return;
    const c=getSourceSetting(model,src).columns||{};
    const baseCols=SOURCE_SETTING_DEFAULTS[src]?.columns || SOURCE_SETTING_DEFAULTS.checklist.columns || {};
    if(c.nameMode==='firstLast'){
      addRequired(req,src,`${labelSource(src)} representative first name`,c.firstName||'First Name');
      addRequired(req,src,`${labelSource(src)} representative last name`,c.lastName||'Last Name');
    }else{
      addRequired(req,src,`${labelSource(src)} representative`,c.fullName||c.rep||baseCols.fullName||baseCols.rep||'Associate Name');
    }
    addRequired(req,src,`${labelSource(src)} coach/team`,c.team||baseCols.team||'Coach Assigned');
  });
  return req;
}
const BASE_EXPECTED_HEADERS = {
  nondate:['Representative','Coach'],
  date:['Representative','Coach','Date'],
  qa:['Conversationid','Genesys Evaluation ID','Agent Name','Hire Date','Team','Calibration Status','Agent Has Read','Interaction Start Time','Interaction End Time','Evaluation Status','Evaluator','Evaluation Form','Queue','VDN','Assigned Date','Changed Date','Days Hired','Score %','Interaction Duration'],
  checklist:['Associate Name','Coach Assigned','Incident Date','Date','Category','Item','Result'],
  documented_coaching:['Associate name','Job Coach','Date','Coaching Date','Category','Item','Result','Notes'],
  comp_calls:['CSR/SSR Name (This is the person being complimented)','Director','CSR Team/Coach','Date of Call','Referral/Claim/WO/Chat Number (Only one type is needed)','Taken By (This is the person reporting the compliment)','Compliment','Date Letter Completed','Coord Initial'],
  retail_sv2:['Agent Name','Name','First Name','Last Name','Team Name','Team','Coach'],
  retail_wiper:['Agent Name','Name','First Name','Last Name','Team Name','Team','Coach'],
  referral_sv2:['Agent Name','Name','First Name','Last Name','Team Name','Team','Coach'],
  referral_wiper:['Agent Name','Name','First Name','Last Name','Team Name','Team','Coach']
};
function uniquePlain(list){
  const out=[]; const seen=new Set();
  (list||[]).forEach(x=>{ x=plainHeaderName(x); const key=norm(x); if(x && key && !seen.has(key)){ seen.add(key); out.push(x); } });
  return out;
}
function expectedHeadersForSource(source, model){
  const names=[...(BASE_EXPECTED_HEADERS[source]||[])];
  try{ const req=requiredColumnsForModel(model).get(source)||[]; req.forEach(x=>names.push(x.expected)); }catch(e){}
  const cols=getSourceSetting(model||{},source).columns||{};
  Object.keys(cols).forEach(k=>names.push(cols[k]));
  return uniquePlain(names);
}
function headersMatchCount(headers, expectedNames){
  expectedNames=uniquePlain(expectedNames);
  return expectedNames.filter(n=>findHeader(headers,[n])).length;
}
function layoutLooksGoodForSource(source, headers, expectedNames, model){
  const q=(getSourceSetting(model||{},source).columns||{});
  if(source==='qa'){
    return !!(findHeader(headers,[q.agent||'Agent Name','AgentName']) && findHeader(headers,[q.team||'Team']) && findHeader(headers,[q.score||'Score %','Score Percent','Evaluation Score']));
  }
  if(isChecklistLikeSource(source)){
    return !!(findHeader(headers,[q.rep||(source==='documented_coaching'?'Associate name':'Associate Name'),'Associate','Agent Name','Rep']) && findHeader(headers,[q.team||(source==='documented_coaching'?'Job Coach':'Coach Assigned'),'Coach Assigned','Job Coach','Coach','Team']));
  }
  const count=headersMatchCount(headers, expectedNames);
  return count>=Math.min(2, uniquePlain(expectedNames).length || 2);
}
function headerMatch(headers, expected){
  if(!expected) return '';
  return findHeader(headers||[],[expected]);
}
function sourceHasImportedData(source){
  if(source===NONDATED_SOURCE) return !!(state.categorized.nondated.rows||[]).length;
  if(source===DATED_SOURCE) return !!(state.categorized.dated.rows||[]).length;
  if(source==='retail_sv2') return !!((state.data.retail.sv2||[]).length||(state.data.retail.sv2Aoa||[]).length);
  if(source==='retail_wiper') return !!((state.data.retail.wiper||[]).length||(state.data.retail.wiperAoa||[]).length);
  if(source==='retail_team_totals') return !!(state.data.retail.teamTotals?.rows||[]).length;
  if(source==='referral_sv2') return !!((state.data.referral.sv2||[]).length||(state.data.referral.sv2Aoa||[]).length);
  if(source==='referral_wiper') return !!((state.data.referral.wiper||[]).length||(state.data.referral.wiperAoa||[]).length);
  if(source==='referral_team_totals') return !!(state.data.referral.teamTotals?.rows||[]).length;
  if(source==='qa') return !!((state.data.qa.rows||[]).length||(state.data.qa.aoa||[]).length);
  if(source===QA_DIRECT_SOURCE) return !!((state.data.qa_direct?.rows||[]).length||(state.data.qa_direct?.aoa||[]).length);
  if(source==='checklist') return !!((state.data.checklist.rows||[]).length||(state.data.checklist.aoa||[]).length);
  if(source==='documented_coaching') return !!((state.data.documented_coaching.rows||[]).length||(state.data.documented_coaching.aoa||[]).length);
  if(source==='comp_calls') return !!((state.data.comp_calls.rows||[]).length||(state.data.comp_calls.aoa||[]).length);
  if(isCustomSource(source)) return !!((customSource(source)?.rows||[]).length||(customSource(source)?.aoa||[]).length);
  return false;
}
function headerWords(s){
  return String(s ?? '').toLowerCase().replace(/%/g,' percent ').replace(/&/g,' and ').match(/[a-z0-9]+/g) || [];
}
function dateHeaderWords(header){
  const raw=plainHeaderName(header).replace(/%20/gi,' ').replace(/_/g,' ');
  const camel=raw.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2');
  return camel.toLowerCase().replace(/%/g,' percent ').replace(/&/g,' and ').match(/[a-z0-9]+/g) || [];
}
function headerLooksLikeDateColumn(header){
  const raw=plainHeaderName(header);
  if(!raw) return false;
  const compact=raw.toLowerCase().replace(/%20/g,'').replace(/[^a-z0-9]+/g,'');
  if(!compact) return false;
  // HireDate/Hire Date is an employee attribute, not an activity/reporting date for categorization.
  if(compact==='hiredate' || compact.endsWith('hiredate')) return false;
  const nonDateTokens=new Set(['candidate','candidates','update','updates','updated','updating','validate','validated','validates','validation']);
  return dateHeaderWords(raw).some(t=>{
    if(!t || nonDateTokens.has(t) || t==='hiredate' || t.endsWith('hiredate')) return false;
    if(t==='date' || t==='dates') return true;
    if(t.length>4 && t.startsWith('date')) return true;
    if(t.length>4 && t.endsWith('date')) return true;
    if(t.length>5 && t.endsWith('dates')) return true;
    return false;
	  });
}
function defaultDateHeaderForSource(source, headers){
  if(sourceAlwaysNonDated(source)) return '';
  headers=headers||getHeaders(source)||[];
  const defaults=source==='qa'
    ? ['Interaction Start Time','Assigned Date','Date']
    : (isChecklistLikeSource(source) ? checklistLikeDefaultDateHeaders(source) : ['Date','Call Date','Interaction Date','Created Date','Completed Date','Week','Week Start','Week Ending','Month']);
  return findHeader(headers,defaults) || headers.find(headerLooksLikeDateColumn) || '';
}
function selectedDateHeaderForSource(source, headers, columns={}){
  if(sourceAlwaysNonDated(source)) return '';
  headers=headers||getHeaders(source)||[];
  const c=columns||getSourceSetting(activeModelForImport(),source).columns||{};
  const auto=defaultDateHeaderForSource(source,headers);
  const useDate=(typeof c.useDateColumn==='boolean') ? c.useDateColumn : !!auto;
  if(!useDate) return '';
  return findHeader(headers,[c.date,c.interactionDate,c.assignedDate,c.week,c.month].filter(Boolean)) || auto;
}
function headerCellMatchScore(header, expected){
  header=plainHeaderName(header); expected=plainHeaderName(expected);
  if(!header || !expected || /^Column_\d+$/i.test(header)) return 0;
  const hn=norm(header), en=norm(expected);
  if(!hn || !en) return 0;
  if(hn===en) return 120;
  const hw=headerWords(header), ew=headerWords(expected);
  const allWords=ew.length && ew.every(w=>hw.includes(w) || hn.includes(w));
  if(allWords) return 105 + Math.min(10, ew.length);
  if(hn.startsWith(en) || en.startsWith(hn)) return Math.min(hn.length,en.length)>=4 ? 90 : 55;
  if((hn.includes(en) || en.includes(hn)) && Math.min(hn.length,en.length)>=4) return 82;
  const matched=ew.filter(w=>w.length>=3 && (hw.includes(w) || hn.includes(w))).length;
  return matched ? 25 + matched*12 : 0;
}
function findHeader(headers, names){
  headers=(headers||[]).map(plainHeaderName).filter(Boolean);
  names=(Array.isArray(names)?names:[names]).map(plainHeaderName).filter(Boolean);
  if(!headers.length || !names.length) return '';
  let best='', bestScore=0;
  headers.forEach(h=>{
    names.forEach(n=>{
      const score=headerCellMatchScore(h,n);
      if(score>bestScore){ bestScore=score; best=h; }
    });
  });
  return bestScore>=70 ? best : '';
}
function setCriterionPrimarySource(c, source){
  if(!c || !source) return;
  c.source=source;
  c.leftSource=source;
  c.rightSource=source;
  c.customSource=source;
  (c.filters||[]).forEach(f=>{ f.source=source; });
}
function alignDisplayColumnCriterion(c){
  if(!c || c.calcType!=='displayColumn') return;
  c.scoreType='display'; c.trueValueEnabled=false; c.weight='1';
  if(c.audience==='both') c.audience='rep';
  c.lookupVersion=2;
  if(!['representative','coach','team','custom'].includes(c.lookupMatchEntity)) c.lookupMatchEntity=c.audience==='rep'?'representative':c.audience==='coach'?'coach':'team';
  if(!c.lookupReturnColumn && c.column) c.lookupReturnColumn=c.column;
  c.displayRules=Array.isArray(c.displayRules)?c.displayRules:[];
}
function runModelColumnCheck(){
  syncEditModelFields();
  const model=state.editModel; if(!model) return;
  applyModelSourceSettings(model);
  const req=requiredColumnsForModel(model);
  const html=[];
  html.push(`<div class="checkResultRow warnRow"><strong>Column check applied this model's header row/start column settings.</strong><div class="checkResultMeta">If anything is missing, adjust the saved settings above, then run the check again. Save the model to keep the changes.</div></div>`);
  if(!req.size){ html.push(`<div class="checkResultRow warnRow"><strong>No required columns found in this model yet.</strong><div class="checkResultMeta">Add criteria or QA/checklist settings, then run the check again.</div></div>`); }
  req.forEach((items,source)=>{
    const headers=getHeaders(source)||[];
    const cfg=getSourceSetting(model,source);
    if(!sourceHasImportedData(source)) html.push(`<div class="checkResultRow warnRow"><strong>${esc(labelSource(source))}: no file imported in this session</strong><div class="checkResultMeta">Expected header row ${cfg.headerRow}, start column ${cfg.startCol}. Import the file, then run this check again.</div></div>`);
    else html.push(`<div class="checkResultRow ${headers.length?'okRow':'badRow'}"><strong>${esc(labelSource(source))}: ${headers.length} headers loaded from row ${esc(cfg.headerRow)}</strong><div class="checkResultMeta">${headers.length?esc(headers.join(' | ')):'No headers loaded from this source.'}</div></div>`);
    items.forEach(item=>{
      const hit=headerMatch(headers,item.expected);
      html.push(`<div class="checkResultRow ${hit?'okRow':'badRow'}"><strong>${hit?'✓':'✗'} ${esc(labelSource(source))} — ${esc(item.label)}</strong><div class="checkResultMeta">Expected: <b>${esc(item.expected)}</b>${hit?` · Found: <b>${esc(hit)}</b>`:' · Not found'} · Header row ${esc(cfg.headerRow)}, start column ${esc(cfg.startCol)}</div>${!hit?`<div class="checkResultMeta">Adjust this source's header row/start column or expected column name above.</div>`:''}</div>`);
    });
  });
  if(els.columnCheckResults) els.columnCheckResults.innerHTML=html.join('');
  renderTeamSelect();
}
function displayRuleHtml(rule,index){
  rule=normalizeDisplayRule(rule);
  const op=[['greater','Greater than'],['greaterEqual','Greater/equal'],['less','Less than'],['lessEqual','Less/equal'],['between','Between'],['equals','Equals'],['contains','Contains'],['blank','Blank'],['notBlank','Not blank'],['dateWithin','Date within X days'],['dateOlder','Date older than X days']].map(([v,l])=>`<option value="${v}" ${rule.op===v?'selected':''}>${l}</option>`).join('');
  const colors=['none','red','yellow','green','blue','gray'].map(v=>`<option value="${v}" ${rule.color===v?'selected':''}>${v==='none'?'No color':v[0].toUpperCase()+v.slice(1)}</option>`).join('');
  return `<div class="displayRuleRow" data-display-rule="${esc(rule.id)}"><div class="field"><label>Condition</label><select data-drule="op">${op}</select></div><div class="field"><label>Value / days</label><input data-drule="value" value="${esc(rule.value)}" placeholder="30"></div><div class="field"><label>High value</label><input data-drule="value2" value="${esc(rule.value2)}" placeholder="60"></div><div class="field"><label>Display label</label><input data-drule="display" value="${esc(rule.display)}" placeholder="NEW HIRE"></div><div class="field"><label>Color</label><select data-drule="color">${colors}</select></div><div class="field"><label>Style</label><select data-drule="style"><option value="cell" ${rule.style==='cell'?'selected':''}>Cell highlight</option><option value="badge" ${rule.style==='badge'?'selected':''}>Badge</option></select></div><button class="smallBtn red" type="button" data-remove-display-rule="${index}">Remove</button></div>`;
}
function criterionHtml(c,i){
  const src=c.source||'retail_sv2';
  const isDisplayColumn=c.calcType==='displayColumn';
  const isCheck=isRowPullCriterion(c); const showRowPull=isCheck; const checkSource=showRowPull?src:'checklist';
  const isQa=!isDisplayColumn&&(src==='qa'||isCustomQAStyleSource(src)); const isWeekly=isCustomWeeklyStatSource(src);
  const isWithinAggregate=['dateWithin','dateWithinPercent','valueWithin','valueWithinPercent'].includes(c.aggregate);
  const weightOptions=['1','2','3','4','5','autofail'].map(w=>`<option value="${w}" ${String(c.weight)===w?'selected':''}>${w==='autofail'?'Autofail':w}</option>`).join('');
  const isAutofailItem = String(c.weight)==='autofail';
  return `<div class="criterionRow" data-crit="${c.id}">
    <div class="row"><strong>${i+1}</strong><button class="smallBtn red" data-remove-crit="${c.id}">Delete</button><button class="smallBtn" data-copy-crit="${c.id}">Copy</button><button class="smallBtn dark" type="button" data-preview-crit="${c.id}">Preview Found</button></div>
    <div class="grid5">
      <div class="field"><label>Name</label><input data-cfield="name" value="${esc(c.name)}"></div>
      <div class="field"><label>Source</label><select data-cfield="source">${isDisplayColumn?displayColumnSourceOptions(c):sourceOptions(src)}</select></div>
      <div class="field"><label>${isDisplayColumn?'Display On':'Applies To'}</label><select data-cfield="audience">${isDisplayColumn?'':`<option value="both" ${c.audience==='both'?'selected':''}>Both</option>`}<option value="rep" ${c.audience==='rep'?'selected':''}>Representatives</option><option value="team" ${c.audience==='team'?'selected':''}>Teams</option>${isDisplayColumn?`<option value="coach" ${c.audience==='coach'?'selected':''}>Coaches</option>`:''}</select></div>
      <div class="field"><label>Type</label><select data-cfield="scoreType" ${isDisplayColumn?'disabled':''}><option value="rank" ${c.scoreType==='rank'?'selected':''}>Rank Item</option><option value="points" ${c.scoreType==='points'?'selected':''}>Points Item</option><option value="display" ${c.scoreType==='display'?'selected':''}>Display Only</option></select></div>
      <div class="field ${isDisplayColumn?'hidden':''}"><label>Weight</label><select data-cfield="weight">${weightOptions}</select></div>
    </div>
    <div class="grid4">
      <div class="field"><label>Calculation</label><select data-cfield="calcType"><option value="single" ${c.calcType==='single'?'selected':''}>Single</option><option value="displayColumn" ${isDisplayColumn?'selected':''}>Display Column (raw cell)</option><option value="multi" ${c.calcType==='multi'?'selected':''}>Multi Item</option><option value="custom" ${c.calcType==='custom'?'selected':''}>Custom</option><option value="qaScore" ${c.calcType==='qaScore'?'selected':''}>QA Score</option><option value="checklistCount" ${c.calcType==='checklistCount'?'selected':''}>Count</option></select></div>
      <div class="field ${isDisplayColumn?'hidden':''}"><label>Direction</label><select data-cfield="direction"><option value="higher" ${c.direction==='higher'?'selected':''}>Higher Best</option><option value="lower" ${c.direction==='lower'?'selected':''}>Lower Best</option></select></div>
      <div class="field ${isDisplayColumn?'hidden':''}"><label>Format</label><select data-cfield="format"><option value="number" ${c.format==='number'?'selected':''}>Number</option><option value="pct" ${c.format==='pct'?'selected':''}>Percent</option></select></div>
      <div class="field ${isDisplayColumn?'hidden':''}"><label>Points</label><input data-cfield="points" type="number" step="0.01" value="${esc(c.points??1)}"></div>
    </div>
    <div class="panel ${c.audience==='rep'||isDisplayColumn?'hidden':''}" data-block="trueValueSettings">
      <label class="checkItem"><input data-cfield="trueValueEnabled" type="checkbox" ${c.trueValueEnabled?'checked':''}> True Value for Team Rankings Only</label>
      <div class="grid2 ${c.trueValueEnabled?'':'hidden'}">
        <div class="field"><label>True Value Source</label><select data-cfield="trueValueSource"><option value="">Select...</option>${TEAM_TOTAL_SOURCE_KEYS.map(k=>`<option value="${k}" ${c.trueValueSource===k?'selected':''}>${esc(labelSource(k))}</option>`).join('')}</select></div>
        <div class="field"><label>True Value Column</label><select data-cfield="trueValueColumn">${headerOptions(c.trueValueSource||'retail_team_totals',c.trueValueColumn)}</select></div>
      </div>
      <div class="hint">Only team rows use this direct value. Representative calculations still use the normal Source and calculation settings.</div>
    </div>
    <div class="noScorePanel ${c.scoreType==='display'?'hidden':''}" data-block="noScoreSettings">
      <div class="noScoreHint">No-score behavior keeps representatives with missing data or disallowed zero values from leading the report. Turn on “0s can win” only when a real zero should be allowed to place first.</div>
      <label class="checkItem"><input data-cfield="zeroCanWin" type="checkbox" ${c.zeroCanWin?'checked':''}> 0s can win for this criteria</label>
      <div class="grid3">
        <div class="field ${c.scoreType==='rank'?'':'hidden'}" data-no-score-rank="1"><label>No Score Rank Assigned</label><input data-cfield="missingRank" type="number" min="1" step="1" value="${esc(c.missingRank??999)}"></div>
        <div class="field ${c.scoreType==='points'?'':'hidden'}" data-no-score-points="1"><label>No Score Points Given</label><input data-cfield="missingPoints" type="number" step="0.01" value="${esc(c.missingPoints??0)}"></div>
        <div class="field ${(isQa||c.calcType==='qaScore')?'':'hidden'}"><label>Minimum Monitors</label><input data-cfield="minimumMonitors" type="number" min="0" step="1" value="${esc(c.minimumMonitors??0)}"></div>
      </div>
    </div>
    <div class="${(isQa||c.calcType==='qaScore')?'':'hidden'}" data-block="qaColumns">
      <div class="panel">
        <div class="panelTitle">QA Score Columns</div>
        <div class="grid4">
          <div class="field"><label>Representative Column</label><select data-qacrit="rep">${headerOptions(src,c.qaColumns?.rep||getSourceSetting(activeModelForImport(),src).columns?.agent||getSourceSetting(activeModelForImport(),src).columns?.rep||'')}</select></div>
          <div class="field"><label>Coach / Team Column</label><select data-qacrit="team">${headerOptions(src,c.qaColumns?.team||getSourceSetting(activeModelForImport(),src).columns?.team||getSourceSetting(activeModelForImport(),src).columns?.coach||'')}</select></div>
          <div class="field"><label>Score Column</label><select data-qacrit="score">${headerOptions(src,c.qaColumns?.score||getSourceSetting(activeModelForImport(),src).columns?.score||'Score %')}</select></div>
          <div class="field"><label>Date Column</label><select data-qacrit="date">${headerOptions(src,c.qaColumns?.date||getSourceSetting(activeModelForImport(),src).columns?.interactionDate||getSourceSetting(activeModelForImport(),src).columns?.date||'Date')}</select></div>
        </div>
      </div>
    </div>
    <div class="${(c.calcType==='single'&&!isQa&&!isCheck)?'':'hidden'}" data-block="single"><div class="grid3">
      <div class="field"><label>Column</label><select data-cfield="column">${headerOptions(src,c.column)}</select></div>
      <div class="field"><label>Rep Aggregate</label><select data-cfield="aggregate"><option value="sum" ${c.aggregate==='sum'?'selected':''}>Sum</option><option value="avg" ${c.aggregate==='avg'?'selected':''}>Average</option><option value="count" ${c.aggregate==='count'?'selected':''}>Count rows</option><option value="uniqueWeeks" ${c.aggregate==='uniqueWeeks'?'selected':''}>Count unique weeks</option><option value="uniqueReps" ${c.aggregate==='uniqueReps'?'selected':''}>Count unique reps</option><option value="latest" ${c.aggregate==='latest'?'selected':''}>Latest row only</option><option value="first" ${c.aggregate==='first'?'selected':''}>First row only</option><option value="max" ${c.aggregate==='max'?'selected':''}>Max</option><option value="min" ${c.aggregate==='min'?'selected':''}>Min</option><option value="percent" ${c.aggregate==='percent'?'selected':''}>Numerator / Denominator percentage</option><option value="dateWithin" ${c.aggregate==='dateWithin'?'selected':''}>Dates within</option><option value="dateWithinPercent" ${c.aggregate==='dateWithinPercent'?'selected':''}>Dates within %</option><option value="valueWithin" ${c.aggregate==='valueWithin'?'selected':''}>Values within</option><option value="valueWithinPercent" ${c.aggregate==='valueWithinPercent'?'selected':''}>Values within %</option><option value="avgWeeklyPercent" ${c.aggregate==='avgWeeklyPercent'?'selected':''}>Average of weekly percentages</option><option value="weightedPercent" ${c.aggregate==='weightedPercent'?'selected':''}>Weighted percentage across all weeks</option></select><div class="hint ${isWeekly?'':'hidden'}">Weekly Stat File groups repeated representative rows before scoring; percentages default to weighted numerator ÷ denominator when mapped.</div></div>
      <div></div>
    </div><div class="grid3 ${isWithinAggregate?'':'hidden'}" data-block="modelWithin">
      <div class="field"><label>Compare column</label><select data-cfield="withinCompareColumn">${headerOptions(src,c.withinCompareColumn)}</select></div>
      <div class="field ${c.withinUseRange?'hidden':''}"><label>${String(c.aggregate).startsWith('date')?'Days within':'Value within'}</label><input data-cfield="withinDays" type="number" step="any" value="${esc(c.withinDays??'')}" placeholder="3"></div>
      <label class="checkItem"><input data-cfield="withinUseRange" type="checkbox" ${c.withinUseRange?'checked':''}> Use range</label>
      <div class="field ${c.withinUseRange?'':'hidden'}"><label>Range low ${String(c.aggregate).startsWith('date')?'days':''}</label><input data-cfield="withinRangeMin" type="number" step="any" value="${esc(c.withinRangeMin??'')}" placeholder="3"></div>
      <div class="field ${c.withinUseRange?'':'hidden'}"><label>Range high ${String(c.aggregate).startsWith('date')?'days':''}</label><input data-cfield="withinRangeMax" type="number" step="any" value="${esc(c.withinRangeMax??'')}" placeholder="5"></div>
    </div></div>
    <div class="${isDisplayColumn?'':'hidden'}" data-block="displayColumn"><div class="panel"><div class="panelTitle">Lookup / Display Column</div><div class="hint">Choose exactly where the entity is stored. Coach values display on the coach's Team row, but the coach is looked up as a person in the selected source and match column. Display fields never affect rank or points.</div><div class="grid4">
      <div class="field"><label>Match Entity</label><select data-cfield="lookupMatchEntity"><option value="representative" ${c.lookupMatchEntity==='representative'?'selected':''}>Representative</option><option value="coach" ${c.lookupMatchEntity==='coach'?'selected':''}>Coach</option><option value="team" ${c.lookupMatchEntity==='team'?'selected':''}>Team</option><option value="custom" ${c.lookupMatchEntity==='custom'?'selected':''}>Custom value</option></select></div>
      <div class="field"><label>${c.audience==='coach'?'Coach Name Expected In':'Match Against Column'}</label><select data-cfield="lookupMatchColumn">${headerOptions(src,c.lookupMatchColumn)}</select></div>
      <div class="field"><label>Return Column</label><select data-cfield="lookupReturnColumn">${headerOptions(src,c.lookupReturnColumn||c.column)}</select></div>
      <div class="field"><label>Record Selection</label><select data-cfield="lookupSelection"><option value="latest" ${c.lookupSelection==='latest'?'selected':''}>Latest nonblank</option><option value="earliest" ${c.lookupSelection==='earliest'?'selected':''}>Earliest nonblank</option><option value="first" ${c.lookupSelection==='first'?'selected':''}>First found</option><option value="last" ${c.lookupSelection==='last'?'selected':''}>Last found</option><option value="mostCommon" ${c.lookupSelection==='mostCommon'?'selected':''}>Most common value</option><option value="highest" ${c.lookupSelection==='highest'?'selected':''}>Highest</option><option value="lowest" ${c.lookupSelection==='lowest'?'selected':''}>Lowest</option><option value="joinUnique" ${c.lookupSelection==='joinUnique'?'selected':''}>Join unique values</option></select></div>
      <div class="field ${c.lookupMatchEntity==='custom'?'':'hidden'}"><label>Custom Match Value</label><input data-cfield="lookupCustomValue" value="${esc(c.lookupCustomValue||'')}"></div>
      <div class="field ${['latest','earliest'].includes(c.lookupSelection)?'':'hidden'}"><label>Record Date Column</label><select data-cfield="lookupDateColumn">${headerOptions(src,c.lookupDateColumn)}</select><span class="hint">If dates are blank, source order is used safely.</span></div>
    </div><div class="grid4">
      <div class="field"><label>Display Mode</label><select data-cfield="displayMode"><option value="lookup" ${c.displayMode!=='calculated'?'selected':''}>Lookup value</option><option value="calculated" ${c.displayMode==='calculated'?'selected':''}>Calculated display</option></select></div>
      <div class="field"><label>Calculation</label><select data-cfield="displayCalculation"><option value="raw" ${c.displayCalculation==='raw'?'selected':''}>Return selected value</option><option value="count" ${c.displayCalculation==='count'?'selected':''}>Count matching records</option><option value="daysSince" ${c.displayCalculation==='daysSince'?'selected':''}>Days since date</option><option value="monthsSince" ${c.displayCalculation==='monthsSince'?'selected':''}>Months since date</option><option value="yearsSince" ${c.displayCalculation==='yearsSince'?'selected':''}>Years since date</option></select></div>
      <div class="field"><label>Value Type</label><select data-cfield="displayValueType"><option value="auto" ${c.displayValueType==='auto'?'selected':''}>Automatic</option><option value="number" ${c.displayValueType==='number'?'selected':''}>Number</option><option value="percent" ${c.displayValueType==='percent'?'selected':''}>Percent</option><option value="date" ${c.displayValueType==='date'?'selected':''}>Date</option><option value="text" ${c.displayValueType==='text'?'selected':''}>Text</option></select></div>
      <div class="field"><label>Missing Value</label><select data-cfield="displayMissingMode"><option value="blank" ${c.displayMissingMode==='blank'?'selected':''}>Blank</option><option value="na" ${c.displayMissingMode==='na'?'selected':''}>N/A</option><option value="notFound" ${c.displayMissingMode==='notFound'?'selected':''}>Not Found</option><option value="zero" ${c.displayMissingMode==='zero'?'selected':''}>0</option><option value="custom" ${c.displayMissingMode==='custom'?'selected':''}>Custom text</option></select></div>
      <div class="field ${c.displayMissingMode==='custom'?'':'hidden'}"><label>Custom Missing Text</label><input data-cfield="displayMissingText" value="${esc(c.displayMissingText||'')}"></div>
    </div><div class="row"><strong>Conditional Formatting &amp; Status Labels</strong><button class="smallBtn green" type="button" data-add-display-rule="${esc(c.id)}">Add Rule</button><span class="hint">Rules run top to bottom; the first match can color the value or replace it with a status label.</span></div><div class="displayRulesList">${(c.displayRules||[]).map(displayRuleHtml).join('')||'<div class="hint">No display rules. The calculated or looked-up value will be shown normally.</div>'}</div></div></div>
    <div class="${c.calcType==='multi'?'':'hidden'}" data-block="multi"><div class="grid5">
      <div class="field"><label>Left Source</label><select data-cfield="leftSource" disabled title="Auto-matches the top Source">${sourceOptions(c.leftSource||src)}</select></div>
      <div class="field"><label>Left Column</label><select data-cfield="leftColumn">${headerOptions(c.leftSource||src,c.leftColumn)}</select></div>
      <div class="field"><label>Operator</label><select data-cfield="operator"><option value="divide" ${c.operator==='divide'?'selected':''}>Divide</option><option value="multiply" ${c.operator==='multiply'?'selected':''}>Multiply</option><option value="plus" ${c.operator==='plus'?'selected':''}>Plus</option><option value="minus" ${c.operator==='minus'?'selected':''}>Minus</option><option value="greaterThan" ${c.operator==='greaterThan'?'selected':''}>Greater Than</option><option value="lessThan" ${c.operator==='lessThan'?'selected':''}>Less Than</option></select></div>
      <div class="field"><label>Right Source</label><select data-cfield="rightSource" disabled title="Auto-matches the top Source">${sourceOptions(c.rightSource||src)}</select></div>
      <div class="field"><label>Right Column</label><select data-cfield="rightColumn">${headerOptions(c.rightSource||src,c.rightColumn)}</select></div>
    </div></div>
    <div class="${c.calcType==='custom'?'':'hidden'}" data-block="custom"><div class="grid2">
      <div class="field"><label>Custom Source</label><select data-cfield="customSource" disabled title="Auto-matches the top Source">${sourceOptions(c.customSource||src)}</select></div>
      <div class="field"><label>Expression</label><input data-cfield="expression" data-expression-input="1" autocomplete="off" value="${esc(c.expression||'')}" placeholder="([Appointments]+[Jobs])/[Opportunities]">${expressionDiagnosticHtml(c.expression,c.customSource||src,'numeric')}</div>
    </div></div>
    <div class="${c.calcType==='checklistCount'||showRowPull?'':'hidden'}" data-block="checklist">
      <div class="grid4"><div class="field"><label>Date Column</label><select data-cfield="checkDateColumn">${headerOptions(checkSource,c.checkDateColumn)}</select></div>${src===DATED_SOURCE?`<div class="field"><label>Number or Text</label><select data-cfield="checkValueType"><option value="text" ${(c.checkValueType||'text')!=='number'?'selected':''}>Text</option><option value="number" ${c.checkValueType==='number'?'selected':''}>Number</option></select></div>`:'<div></div>'}<div></div><div></div></div>
      <div class="row" style="margin:6px 0"><strong>Date row pull conditions</strong><button class="smallBtn" type="button" data-add-row-pull="${c.id}">Add condition</button></div>
      <div data-row-pull-for="${c.id}">${ensureRowPullConditions(c).map((cond,i,arr)=>rowPullConditionHtml(c.id,cond,i,arr.length)).join('')}</div>
    </div>
    <div class="${isAutofailItem?'grid4':'grid4 hidden'}" data-block="autofailSettings">
      <div class="field"><label>Required Minimum</label><select data-cfield="minimumEnabled"><option value="false" ${!c.minimumEnabled?'selected':''}>No</option><option value="true" ${c.minimumEnabled?'selected':''}>Yes</option></select></div>
      <div class="field"><label>Minimum</label><input data-cfield="minimum" type="number" step="0.01" value="${esc(c.minimum??0)}"></div>
      <div class="field"><label>Autofail Count</label><input data-cfield="autofailThreshold" type="number" step="0.01" value="${esc(c.autofailThreshold??1)}"></div>
      <div class="field"><label>Autofail Check</label><select data-cfield="autofailOperator"><option value="greaterEqual" ${c.autofailOperator==='greaterEqual'?'selected':''}>>=</option><option value="greaterThan" ${c.autofailOperator==='greaterThan'?'selected':''}>&gt;</option><option value="equals" ${c.autofailOperator==='equals'?'selected':''}>=</option></select></div>
    </div>
    <div class="panel"><div class="row"><strong>Filters</strong><button class="smallBtn" data-add-filter="${c.id}">Add Filter</button></div><div data-filters-for="${c.id}">${(c.filters||[]).map(f=>filterHtml(c.id,f)).join('')}</div></div>
    <div data-model-found-preview-for="${c.id}" class="researchPreviewBox hidden"></div>
  </div>`;
}
function rowPullConditionHtml(cid,cond,idx,total){
  const criterion=getEditCriterion(cid)||{};
  const valueType=criterion.source===DATED_SOURCE && criterion.checkValueType==='number' ? 'number' : 'text';
  const warn=valueType==='number' ? '' : parseQuotedPhrases(cond.phrasesText).warning;
  const activeOp=normalizeRowPullOperator(cond.operator,valueType);
  const opOpts=rowPullOperatorsForType(valueType).map(op=>`<option value="${op}" ${activeOp===op?'selected':''}>${rowPullOperatorLabel(op)}</option>`).join('');
  const connOpts=['and','or','andSeparate'].map(op=>`<option value="${op}" ${cond.connector===op?'selected':''}>${rowPullConnectorLabel(op)}</option>`).join('');
  const separate=cond.connector==='andSeparate';
  const valueLabel=valueType==='number' ? (activeOp==='between'?'Low / High':'Number value') : 'Quoted phrases';
  const valuePlaceholder=valueType==='number' ? (activeOp==='between'?'50, 100':'100') : '"Final", "Written", "Verbal"';
  return `<div class="rowPullCondition" data-row-pull-condition="${cond.id}">
    <div class="grid5">
      <div class="field">${idx?`<label>Connector</label><select data-rpfield="connector">${connOpts}</select>`:'<label>Connector</label><span class="badge">Base condition</span>'}</div>
      <div class="field"><label>${separate?'Separate-row Date Column':'Date Column'}</label><select data-rpfield="dateColumn" ${separate?'':'disabled'}>${headerOptions(getEditCriterion(cid)?.source||'checklist',cond.dateColumn)}</select><div class="hint">${separate?'Checks another row for the same representative in the run date range.':'Uses the criteria Date Column above.'}</div></div>
      <div class="field"><label>Column</label><select data-rpfield="column">${headerOptions(getEditCriterion(cid)?.source||'checklist',cond.column)}</select></div>
      <div class="field"><label>Operator</label><select data-rpfield="operator">${opOpts}</select></div>
      <div class="field"><label>${valueLabel}</label><input data-rpfield="phrasesText" value="${esc(cond.phrasesText||'')}" placeholder="${esc(valuePlaceholder)}">${warn?`<div class="rowPullWarn">${esc(warn)}</div>`:''}</div>
      <div class="field"><label>Preview / Remove</label><button class="smallBtn" type="button" data-preview-row-pull="${cid}|${cond.id}">Preview</button> <button class="smallBtn red" type="button" data-remove-row-pull="${cid}|${cond.id}" ${total<=1?'disabled':''}>Remove</button></div>
    </div>
  </div>`;
}
function filterHtml(cid,f){
  const c=getEditCriterion(cid)||{};
  f=normalizeFilterForStorage(f,c.source||'retail_sv2');
  const vals=uniqueValues(f.source,f.column);
  const selected=new Set(f.values||[]);
  const numeric=isNumericFilterOperator(f.operator);
  const freeText=isFreeTextFilterOperator(f.operator);
  const dateAware=f.action==='includeWithin'||f.action==='excludeWithin';
  const operatorOptions=['is','isNot','contains','notContains','greaterThan','greaterEqual','lessThan','lessEqual','between'].map(op=>`<option value="${op}" ${f.operator===op?'selected':''}>${filterOperatorLabel(op)}</option>`).join('');
  const actionOptions=[['include','Only include'],['exclude','Exclude'],['includeWithin','Only include if within'],['excludeWithin','Only exclude if within']].map(([v,l])=>`<option value="${v}" ${f.action===v?'selected':''}>${l}</option>`).join('');
  const columnControl=numeric && f.dynamicColumn
    ? `<label class="checkItem" style="margin-bottom:6px"><input data-ff="dynamicColumn" type="checkbox" checked> Dynamic column/expression</label><input data-ff="columnExpression" data-filter-expression-input="1" autocomplete="off" value="${esc(f.columnExpression||'')}" placeholder="e.g. [Cash Apps] / [Cash Opps]">`
    : `<label class="checkItem" style="margin-bottom:6px"><input data-ff="dynamicColumn" type="checkbox" ${f.dynamicColumn?'checked':''}> Dynamic column/expression</label><select data-ff="column">${headerOptions(f.source||'retail_sv2',f.column)}</select>`;
  let valueControl='';
  if(f.operator==='between'){
    valueControl=`<div class="grid2"><input data-ff="value" type="text" inputmode="decimal" value="${esc(f.value||'')}" placeholder="Low"><input data-ff="value2" type="text" inputmode="decimal" value="${esc(f.value2||'')}" placeholder="High"></div>`;
  }else if(numeric){
    valueControl=`<label class="checkItem" style="margin-bottom:6px"><input data-ff="dynamic" type="checkbox" ${f.dynamic?'checked':''}> Dynamic value</label><input data-ff="${f.dynamic?'expression':'value'}" ${f.dynamic?'data-filter-expression-input="1" autocomplete="off"':'type="text" inputmode="decimal"'} value="${esc(f.dynamic ? (f.expression||'') : (f.value||''))}" placeholder="${f.dynamic?'e.g. [Cash Opps] + ![Retail Wipers].[Cash Opps]':'Enter a number'}">`;
  }else if(freeText){
    valueControl=`<input data-ff="value" value="${esc(f.value||'')}" placeholder="Text or quoted phrase to match">`;
  }else{
    valueControl=`<select multiple data-ff="values" size="4">${vals.map(v=>`<option value="${esc(v)}" ${selected.has(v)?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
  }
  const dateExtra=dateAware?`<div class="panel" style="grid-column:1/-1;background:#f8fafc"><div class="row"><strong>Date-aware match</strong><span class="hint">Checks QA, Checklist, Documented Coaching, or Comp Calls rows for the same representative/coach within the selected date window.</span></div><div class="grid4">
      <div class="field"><label>Target source</label><select data-ff="targetSource">${['qa',DATED_SOURCE,'checklist','documented_coaching','comp_calls'].map(src=>`<option value="${src}" ${(f.targetSource||'qa')===src?'selected':''}>${esc(labelSource(src))}</option>`).join('')}</select></div>
      <div class="field"><label>Target date column</label><select data-ff="targetDateColumn">${targetDateColumnOptions(f.targetSource||'qa',f.targetDateColumn||'')}</select></div>
      <div class="field"><label>Target value column</label><select data-ff="targetValueColumn">${headerOptions(f.targetSource||'qa',f.targetValueColumn||'',true)}</select></div>
      <div class="field"><label>Target match mode</label><select data-ff="targetOp">${['contains','is','does not contain'].map(o=>`<option value="${o}" ${(f.targetOp||'contains')===o?'selected':''}>${o==='is'?'is exactly':o}</option>`).join('')}</select></div>
      <div class="field"><label>Target phrase/value</label><input data-ff="targetValue" value="${esc(f.targetValue||'')}" placeholder='"Final" or Final'></div>
      <div class="field"><label>Date window mode</label><select data-ff="windowMode"><option value="days" ${(f.windowMode||'days')==='days'?'selected':''}>Within X days</option><option value="range" ${f.windowMode==='range'?'selected':''}>Within range</option></select></div>
      ${f.windowMode==='range'?`<div class="field"><label>Range start</label><input type="date" data-ff="rangeStart" value="${esc(f.rangeStart||'')}"></div><div class="field"><label>Range end</label><input type="date" data-ff="rangeEnd" value="${esc(f.rangeEnd||'')}"></div>`:`<div class="field"><label>Day window</label><input data-ff="dayWindow" value="${esc(f.dayWindow||'0')}" placeholder="0, 1, -1, A15"></div>`}
    </div></div>`:'';
  if(dateAware){
    return `<div class="filterRow" data-filter="${f.id}"><div class="grid5">
      <div class="field"><label>Filter Action</label><select data-ff="action">${actionOptions}</select></div>
      <div class="field"><label>Remove</label><button class="smallBtn red" data-remove-filter="${cid}|${f.id}">Delete</button></div>
      ${dateExtra}
    </div></div>`;
  }
  return `<div class="filterRow" data-filter="${f.id}"><div class="grid5">
    <div class="field"><label>Filter Action</label><select data-ff="action">${actionOptions}</select></div>
    <div class="field"><label>Source</label><select data-ff="source">${sourceOptions(f.source||c.source||'retail_sv2')}</select></div>
    <div class="field"><label>Column / Expression</label>${columnControl}</div>
    <div class="field"><label>Operator</label><select data-ff="operator">${operatorOptions}</select></div>
    <div class="field"><label>${f.operator==='between'?'Low / High':numeric?'Value':freeText?'Text':'Values'}</label>${valueControl}</div>
    <div class="field"><label>Remove</label><button class="smallBtn red" data-remove-filter="${cid}|${f.id}">Delete</button></div>
  </div></div>`;
}
async function modelCriterionPreviewRows(c, opts={}){
  if(!c) return [];
  const source=isRowPullCriterion(c)?rowPullSourceForCriterion(c):(c.source||'retail_sv2');
  const baseOpts={...opts,dateColumn:c.checkDateColumn};
  const raw=getRowsRaw(source)||[];
  const chunkSize=Number(opts.chunkSize)||900;
  let rows=[];
  for(let i=0;i<raw.length;i+=chunkSize){
    const chunk=raw.slice(i,i+chunkSize);
    rows.push(...filterRowsForSource(source,chunk,baseOpts));
    updateProgress(`Preview Found: checking date range (${Math.min(i+chunkSize,raw.length).toLocaleString()}/${raw.length.toLocaleString()})`, 30 + 18*Math.min(1,(i+chunkSize)/Math.max(1,raw.length)));
    await yieldToBrowser();
  }
  const filters=c.filters||[];
  for(let fi=0;fi<filters.length;fi++){
    const next=[];
    for(let i=0;i<rows.length;i+=chunkSize){
      const chunk=rows.slice(i,i+chunkSize);
      next.push(...applyFilters(chunk,[filters[fi]],source,baseOpts));
      updateProgress(`Preview Found: applying filter ${fi+1}/${filters.length} (${Math.min(i+chunkSize,rows.length).toLocaleString()}/${rows.length.toLocaleString()})`, 48 + 28*((fi + Math.min(1,(i+chunkSize)/Math.max(1,rows.length)))/Math.max(1,filters.length)));
      await yieldToBrowser();
    }
    rows=next;
  }
  if(isRowPullCriterion(c)){
    const conditions=ensureRowPullConditions(c).map(cond=>({...cond,column:resolveColumn(source,cond.column),dateColumn:resolveColumn(source,cond.dateColumn||c.checkDateColumn)})).filter(cond=>cond.column && String(cond.phrasesText||'').trim());
    if(conditions.length){
      const next=[];
      for(let i=0;i<rows.length;i+=chunkSize){
        const chunk=rows.slice(i,i+chunkSize);
        chunk.forEach(r=>{ if(checklistRowPassesConditions(source,r,{kind:'rep',key:r._repKey,name:r._rep,team:r._team},{...baseOpts,checkValueType:c.checkValueType||'text'},conditions)) next.push(r); });
        updateProgress(`Preview Found: matching quoted phrasing (${Math.min(i+chunkSize,rows.length).toLocaleString()}/${rows.length.toLocaleString()})`, 78 + 17*Math.min(1,(i+chunkSize)/Math.max(1,rows.length)));
        await yieldToBrowser();
      }
      rows=next;
    }
  }
  updateProgress('Preview Found: preparing preview table', 98);
  await yieldToBrowser();
  return rows;
}
function likelyPreviewDate(row,source,c){
  if(source==='qa') return ymd(row._interactionDate||row._assignedDate||row._date)||'';
  const h=resolveColumn(source,c?.checkDateColumn) || findHeader(getHeaders(source),checklistLikeDefaultDateHeaders(source)) || findHeader(getHeaders(source),['Date','Created Date','Completed Date','Interaction Start Time']);
  return h ? String(row[h]??'') : '';
}
function renderModelCriterionPreview(c, rows){
  const source=isRowPullCriterion(c)?rowPullSourceForCriterion(c):(c.source||'retail_sv2');
  const reps=[]; const coaches=[]; const seenR=new Set(), seenC=new Set();
  (rows||[]).forEach(r=>{ const rn=r._rep||''; const cn=rowTeam(r)||r._team||''; if(rn&&!seenR.has(rn)&&reps.length<25){seenR.add(rn); reps.push(rn);} if(cn&&!seenC.has(cn)&&coaches.length<25){seenC.add(cn); coaches.push(cn);} });
  const important=[c.column,c.leftColumn,c.rightColumn,c.checkDateColumn,c.checkColumn].map(plainHeaderName).filter(Boolean);
  (c.filters||[]).forEach(f=>{ if(f.column) important.push(plainHeaderName(f.column)); if(f.targetValueColumn) important.push(plainHeaderName(f.targetValueColumn)); });
  const headers=[]; const seen=new Set();
  ['_rep','_team'].concat(important).concat(getHeaders(source)||[]).forEach(h=>{ const x=plainHeaderName(h); if(x&&!seen.has(x)&&headers.length<10){seen.add(x); headers.push(x);} });
  const shown=(rows||[]).slice(0,50);
  const summary=`<div class="researchPreviewSummary"><span class="badge">${(rows||[]).length.toLocaleString()} found</span><span class="badge">Showing first ${shown.length}</span><span class="badge">${esc(labelSource(source))}</span><span class="badge">${(c.filters||[]).length} filters</span></div>
    <div class="grid2"><div><strong>Coaches/Teams preview</strong><div class="hint">${coaches.length?esc(coaches.join(' | ')):'None found'}</div></div><div><strong>Representatives preview</strong><div class="hint">${reps.length?esc(reps.join(' | ')):'None found'}</div></div></div>`;
  const table=`<div class="researchTableWrap" style="margin-top:8px"><table><thead><tr><th>#</th><th>Source</th><th>Date</th>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(labelSource(source))}</td><td>${esc(likelyPreviewDate(r,source,c))}</td>${headers.map(h=>`<td>${esc(h==='_rep'?r._rep:h==='_team'?rowTeam(r):r[resolveColumn(source,h)||h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return summary+table;
}
async function showModelCriterionPreview(cid){
  const c=getEditCriterion(cid); if(!c) return;
  syncEditModelFields();
  const box=els.criteriaList?.querySelector(`[data-model-found-preview-for="${cid}"]`);
  const opts={qaDateMode:els.runQADateSelect?.value||'interaction',_sourceRowsCache:new Map(),_entryRowsCache:new Map(),chunkSize:900};
  if(box){ box.classList.remove('hidden'); box.innerHTML='<div class="researchPreviewSummary"><span class="badge">Preview Found is scanning in chunks...</span></div>'; }
  try{
    showProgress(dataIndexReady() ? 'Preview Found: preparing rows...' : 'Preview Found: refreshing data index...', 2);
    await rebuildDataIndexAsync('Preview Found: refreshing data index', {start:2,end:28,chunkSize:900});
    const rows=await modelCriterionPreviewRows(c,opts);
    if(box){ box.classList.remove('hidden'); box.innerHTML=renderModelCriterionPreview(c,rows); }
    updateProgress('Preview Found complete',100);
    await yieldToBrowser();
  }catch(e){
    if(box){ box.classList.remove('hidden'); box.innerHTML=`<div class="researchWarn">${esc(e.message||e)}</div>`; }
  }finally{
    hideProgress();
  }
}

function bindCriteriaEditors(){
  els.criteriaList.querySelectorAll('[data-cfield]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const box=input.closest('[data-crit]'); const c=getEditCriterion(box.dataset.crit); if(!c) return;
      const field=input.dataset.cfield;
      let val=input.type==='checkbox' ? input.checked : input.value;
      if(field==='minimumEnabled') val=val==='true';
      if(field==='zeroCanWin') val=!!val;
      if(field==='withinUseRange') val=!!val;
      if(['points','minimum','autofailThreshold','missingPoints'].includes(field)) val=Number(val)||0;
      if(field==='minimumMonitors') val=Math.max(0,Math.floor(Number(val)||0));
      if(field==='missingRank') val=Math.max(1,Number(val)||999);
      if(field==='source'){
        const wasDisplayColumn=c.calcType==='displayColumn';
        setCriterionPrimarySource(c,val);
        if(!wasDisplayColumn){
          if(val==='qa' || isCustomQAStyleSource(val)){ c.calcType='qaScore'; c.format='pct'; }
          else if(val===DATED_SOURCE){ c.calcType='single'; c.aggregate=c.aggregate||'sum'; c.checkValueType=c.checkValueType||'text'; }
          else if(isDatedRowPullSource(val)){ c.calcType='checklistCount'; }
          else if(c.calcType==='qaScore' || c.calcType==='checklistCount'){ c.calcType='single'; }
        }
      }else{
        c[field]=val;
      }
      if(field==='calcType' || field==='audience' || field==='source') alignDisplayColumnCriterion(c);
      if(field==='expression') showHeaderSuggestions(input,c);
      if(field==='checkValueType'){
        ensureRowPullConditions(c).forEach(cond=>{ cond.operator=normalizeRowPullOperator(cond.operator,c.checkValueType||'text'); });
      }
      if(['source','weight','scoreType','calcType','aggregate','withinUseRange','leftSource','rightSource','customSource','checkColumn','checkDateColumn','checkValueType','audience','trueValueEnabled','trueValueSource','lookupMatchEntity','lookupSelection','displayMode','displayCalculation','displayMissingMode'].includes(field)) renderEditModel();
    };
  });
  els.criteriaList.querySelectorAll('[data-expression-input]').forEach(input=>{
    input.onfocus=()=>{ const box=input.closest('[data-crit]'); const c=getEditCriterion(box?.dataset.crit); if(c) showHeaderSuggestions(input,c); };
    input.onkeyup=()=>{ const box=input.closest('[data-crit]'); const c=getEditCriterion(box?.dataset.crit); if(c) showHeaderSuggestions(input,c); };
    input.onblur=()=>setTimeout(hideHeaderSuggestions,160);
  });
  els.criteriaList.querySelectorAll('[data-qacrit]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const box=input.closest('[data-crit]'); const c=getEditCriterion(box?.dataset.crit); if(!c) return;
      c.qaColumns=c.qaColumns||{};
      c.qaColumns[input.dataset.qacrit]=input.value;
    };
  });
  els.criteriaList.querySelectorAll('[data-remove-crit]').forEach(b=>b.onclick=()=>{state.editModel.criteria=state.editModel.criteria.filter(c=>c.id!==b.dataset.removeCrit); renderEditModel();});
  els.criteriaList.querySelectorAll('[data-copy-crit]').forEach(b=>b.onclick=()=>{const c=getEditCriterion(b.dataset.copyCrit); if(c){const n=JSON.parse(JSON.stringify(c)); n.id=id(); n.name=n.name+' Copy'; state.editModel.criteria.push(n); renderEditModel();}});
  els.criteriaList.querySelectorAll('[data-add-display-rule]').forEach(b=>b.onclick=()=>{ const c=getEditCriterion(b.dataset.addDisplayRule); if(!c) return; c.displayRules=c.displayRules||[]; c.displayRules.push(normalizeDisplayRule({})); renderEditModel(); });
  els.criteriaList.querySelectorAll('[data-remove-display-rule]').forEach(b=>b.onclick=()=>{ const c=getEditCriterion(b.closest('[data-crit]')?.dataset.crit); if(!c) return; c.displayRules=(c.displayRules||[]).filter((_,i)=>i!==Number(b.dataset.removeDisplayRule)); renderEditModel(); });
  els.criteriaList.querySelectorAll('[data-display-rule]').forEach(row=>row.querySelectorAll('[data-drule]').forEach(input=>{ input.onchange=input.oninput=()=>{ const c=getEditCriterion(input.closest('[data-crit]')?.dataset.crit), rule=(c?.displayRules||[]).find(x=>x.id===row.dataset.displayRule); if(rule) rule[input.dataset.drule]=input.value; }; }));
  els.criteriaList.querySelectorAll('[data-preview-crit]').forEach(b=>b.onclick=()=>showModelCriterionPreview(b.dataset.previewCrit));
  els.criteriaList.querySelectorAll('[data-add-filter]').forEach(b=>b.onclick=()=>{const c=getEditCriterion(b.dataset.addFilter); c.filters=c.filters||[]; c.filters.push({id:id(),action:'include',mode:'include',operator:'is',source:c.source||'retail_sv2',column:'',values:[],value:'',value2:'',targetSource:'qa',targetDateColumn:'',targetValueColumn:'',targetOp:'contains',targetValue:'',windowMode:'days',dayWindow:'0'}); renderEditModel();});
  els.criteriaList.querySelectorAll('[data-remove-filter]').forEach(b=>b.onclick=()=>{const [cid,fid]=b.dataset.removeFilter.split('|'); const c=getEditCriterion(cid); c.filters=(c.filters||[]).filter(f=>f.id!==fid); renderEditModel();});
  els.criteriaList.querySelectorAll('[data-add-row-pull]').forEach(b=>b.onclick=()=>{ const c=getEditCriterion(b.dataset.addRowPull); ensureRowPullConditions(c); c.rowPullConditions.push({id:id(),connector:'and',column:'',dateColumn:c.checkDateColumn||'',operator:'contains',phrasesText:''}); renderEditModel(); });
  els.criteriaList.querySelectorAll('[data-remove-row-pull]').forEach(b=>b.onclick=()=>{ const [cid,rid]=b.dataset.removeRowPull.split('|'); const c=getEditCriterion(cid); c.rowPullConditions=ensureRowPullConditions(c).filter(x=>x.id!==rid); if(!c.rowPullConditions.length) c.rowPullConditions.push({id:id(),connector:'and',column:'',dateColumn:c.checkDateColumn||'',operator:'contains',phrasesText:''}); renderEditModel(); });
  els.criteriaList.querySelectorAll('[data-preview-row-pull]').forEach(b=>b.onclick=()=>{ const [cid,rid]=b.dataset.previewRowPull.split('|'); const c=getEditCriterion(cid); const cond=ensureRowPullConditions(c).find(x=>x.id===rid); showColumnPreview(c.source||'checklist',cond?.column||''); });
  els.criteriaList.querySelectorAll('[data-rpfield]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const critBox=input.closest('[data-crit]'); const rowBox=input.closest('[data-row-pull-condition]'); const c=getEditCriterion(critBox.dataset.crit); const cond=ensureRowPullConditions(c).find(x=>x.id===rowBox.dataset.rowPullCondition); if(!cond) return;
      const rpField=input.dataset.rpfield;
      cond[rpField]=input.value;
      if(rpField==='operator') cond.operator=normalizeRowPullOperator(cond.operator, c.source===DATED_SOURCE && c.checkValueType==='number'?'number':'text');
      const first=c.rowPullConditions[0]; if(first){ c.checkColumn=first.column; c.checkOperator=first.operator; c.checkText=first.phrasesText; }
      if(['column','operator','connector','dateColumn'].includes(rpField)) renderEditModel();
      else {
        const warn=input.parentElement.querySelector('.rowPullWarn');
        const msg=(c.source===DATED_SOURCE && c.checkValueType==='number') ? '' : parseQuotedPhrases(input.value).warning;
        if(msg && !warn) input.insertAdjacentHTML('afterend',`<div class="rowPullWarn">${esc(msg)}</div>`);
        else if(warn) warn.textContent=msg;
      }
    };
  });
  els.criteriaList.querySelectorAll('[data-ff]').forEach(input=>{
    input.onchange=input.oninput=()=>{
      const critBox=input.closest('[data-crit]'); const filterBox=input.closest('[data-filter]'); const c=getEditCriterion(critBox.dataset.crit); const f=(c.filters||[]).find(x=>x.id===filterBox.dataset.filter); if(!f) return;
      const field=input.dataset.ff;
      if(field==='values') f.values=Array.from(input.selectedOptions).map(o=>o.value);
      else if(field==='dynamic') f.dynamic=!!input.checked;
      else if(field==='dynamicColumn') f.dynamicColumn=!!input.checked;
      else { f[field]=input.value; if(field==='action') f.mode=input.value; }
      if(field==='expression' || field==='columnExpression') showHeaderSuggestions(input,{source:f.source||c.source,customSource:f.source||c.source});
      if(['source','column','operator','dynamic','dynamicColumn','action','targetSource','windowMode'].includes(field)) renderEditModel();
    };
  });
  els.criteriaList.querySelectorAll('[data-filter-expression-input]').forEach(input=>{
    input.onfocus=()=>{ const critBox=input.closest('[data-crit]'); const filterBox=input.closest('[data-filter]'); const c=getEditCriterion(critBox?.dataset.crit); const f=(c?.filters||[]).find(x=>x.id===filterBox?.dataset.filter); if(f) showHeaderSuggestions(input,{source:f.source||c.source,customSource:f.source||c.source}); };
    input.onkeyup=()=>input.onfocus();
    input.onblur=()=>setTimeout(hideHeaderSuggestions,160);
  });
}
function ensureHeaderSuggestMenu(){
  let menu=document.getElementById('headerSuggestMenu');
  if(!menu){ menu=document.createElement('div'); menu.id='headerSuggestMenu'; menu.className='headerSuggestMenu'; document.body.appendChild(menu); }
  return menu;
}
function expressionTokenInfo(input){
  const value=input.value||'', pos=input.selectionStart??value.length, before=value.slice(0,pos);
  const cross=before.match(/!\[([^\]]*)$/);
  if(cross) return {mode:'source',start:pos-cross[1].length-2,end:pos,text:cross[1],bracketed:true};
  const crossHeader=before.match(/!\[([^\]]+)\]\s*\.\s*\[([^\]]*)$/);
  if(crossHeader){ const source=sourceKeyFromExpressionLabel(crossHeader[1]); return {mode:'crossHeader',source,start:pos-crossHeader[2].length-1,end:pos,text:crossHeader[2],bracketed:true}; }

  // Loose cross-source syntax: !nondate.retail.wipers, !date.retail.wipers.accepted,
  // !Retail SV2.Cash Apps, etc.  This keeps the typed source and completes only the field part.
  const bang=before.lastIndexOf('!');
  if(bang>=0){
    const bangBody=before.slice(bang+1);
    const loose=splitSourceQualifiedLooseRef(bangBody);
    if(loose){
      const rawField=String(loose.rawField||'');
      const fieldStartInBody=Math.max(0,bangBody.length-rawField.length);
      return {mode:'crossHeader',source:sourceKeyFromExpressionLabel(loose.rawSource),start:bang+1+fieldStartInBody,end:pos,text:rawField,bracketed:false,loose:true};
    }
    if(bang>=0 && before.slice(bang).indexOf(']')<0){ return {mode:'source',start:bang,end:pos,text:bangBody.replace(/^\[/,''),bracketed:false}; }
  }

  const open=before.lastIndexOf('['), close=before.lastIndexOf(']');
  if(open>close) return {mode:'header',start:open,end:pos,text:before.slice(open+1),bracketed:true};

  // Include dots so "retail.wipers" and "retail.wipers.ac" remain one search token.
  const m=before.match(/[A-Za-z0-9_%&.][A-Za-z0-9_%&.\s-]*$/);
  if(!m) return {mode:'header',start:pos,end:pos,text:'',bracketed:false};
  const raw=m[0], leading=(raw.match(/^\s*/)||[''])[0].length;
  return {mode:'header',start:pos-raw.length+leading,end:pos,text:raw.trim(),bracketed:false};
}
function hideHeaderSuggestions(){ const menu=document.getElementById('headerSuggestMenu'); if(menu) menu.classList.remove('open'); }

function sourceAliasTextForHeaderSuggest(src){
  const aliases=[src,labelSource(src)];
  if(src===NONDATED_SOURCE) aliases.push('nondate','non-date','nondated','non dated','non date database','nondated database');
  if(src===DATED_SOURCE) aliases.push('date','dated','date database','dated database');
  return aliases.filter(Boolean).join(' ');
}
function headerSuggestTerms(query){
  return String(query||'')
    .toLowerCase()
    .replace(/%/g,' percent ')
    .replace(/&/g,' and ')
    .split(/[^a-z0-9]+/g)
    .map(x=>x.trim())
    .filter(Boolean);
}
function headerSuggestMatches(text, query){
  const terms=headerSuggestTerms(query);
  if(!terms.length) return true;
  const hay=String(text||'').toLowerCase().replace(/%/g,' percent ').replace(/&/g,' and ');
  const compact=hay.replace(/[^a-z0-9]+/g,'');
  return terms.every(t=>hay.includes(t) || compact.includes(t.replace(/[^a-z0-9]+/g,'')));
}
function headerSuggestScore(label, query, source='', defaultSource=''){
  const q=String(query||'').trim();
  if(!q) return source===defaultSource ? 0 : 20;
  const nq=norm(q), nl=norm(label), alias=researchExpressionAlias(label);
  let score=50;
  if(nl===nq || alias===nq) score-=45;
  else if(nl.startsWith(nq) || alias.startsWith(nq)) score-=35;
  else if(nl.includes(nq) || alias.includes(nq)) score-=25;
  const terms=headerSuggestTerms(q);
  if(terms.length && terms.every((t,i)=>headerSuggestTerms(label)[i]===t)) score-=12;
  if(source===defaultSource) score-=8;
  if(source===NONDATED_SOURCE || source===DATED_SOURCE) score-=3;
  return score;
}
function expressionHeaderCandidateSources(defaultSource, explicitSource=''){
  const out=[], add=src=>{ if(src && allSourceKeys().includes(src) && !out.includes(src)) out.push(src); };
  if(explicitSource) add(explicitSource);
  else {
    add(defaultSource);
    add(NONDATED_SOURCE);
    add(DATED_SOURCE);
    if(!defaultSource || isDynamicResearchSource(defaultSource)) allSourceKeys().forEach(add);
  }
  return out;
}
function expressionHeaderCandidates(defaultSource, explicitSource='', query=''){
  const candidates=[];
  expressionHeaderCandidateSources(defaultSource,explicitSource).forEach(src=>{
    (getHeaders(src)||[]).map(plainHeaderName).filter(Boolean).forEach(h=>{
      const searchText=`${h} ${labelSource(src)} ${src} ${sourceAliasTextForHeaderSuggest(src)}`;
      if(headerSuggestMatches(searchText,query)) candidates.push({kind:'header',label:h,source:src,detail:labelSource(src),insert:null});
    });
  });
  (state.metrics||[]).forEach(m=>{
    const label='@'+(m.name||m.id||'Metric');
    if(headerSuggestMatches(label+' metric '+(m.notes||''),query)) candidates.push({kind:'metric',label,source:m.source||defaultSource,detail:'Metric',insert:label});
  });
  const seen=new Set();
  return candidates.filter(c=>{
    const key=[c.kind,c.source,c.label].join('\u0001');
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b)=>headerSuggestScore(a.label,query,a.source,defaultSource)-headerSuggestScore(b.label,query,b.source,defaultSource) || (a.detail||'').localeCompare(b.detail||'') || a.label.localeCompare(b.label));
}
function headerInsertNeedsBrackets(input, info){
  // Header autocomplete should always insert bracketed field references.
  // The resolver now unwraps [Header] for simple field boxes, so this stays safe
  // while preventing first-token expressions like retail.wipers.accepted from scoring as raw text.
  return true;
}
function insertHeaderIntoExpression(input, info, item, defaultSource=''){
  const value=input.value||'';
  const candidate=typeof item==='string' ? {kind:'header',label:item,source:defaultSource} : (item||{kind:'header',label:''});
  const useBrackets=headerInsertNeedsBrackets(input,info);
  let insertion='';
  if(candidate.kind==='metric') insertion=candidate.insert || candidate.label;
  else if(info.mode==='crossHeader' || (candidate.source && defaultSource && candidate.source!==defaultSource)){
    insertion=(info.mode==='crossHeader' && info.bracketed && !info.loose)
      ? `[${plainHeaderName(candidate.label)}]`
      : sourceQualifiedFieldSuggestion(candidate.source||defaultSource,candidate.label);
  }else{
    // Keep every selected header bracketed. Example expression: [retail.wipers.accepted].
    insertion=useBrackets ? `[${plainHeaderName(candidate.label)}]` : plainHeaderName(candidate.label);
  }
  input.value=value.slice(0,info.start)+insertion+value.slice(info.end);
  const pos=info.start+insertion.length;
  input.focus(); input.setSelectionRange(pos,pos);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  hideHeaderSuggestions();
}
function headerAutocompleteContext(input){
  let source='';
  if(input?.getAttribute?.('list')==='metricHeaderSuggestions') source=els.metricSourceSelect?.value || firstImportedResearchSource?.() || 'qa';
  if(!source && els.researchEditorModal?.contains(input)) source=els.researchSource?.value || DYNAMIC_RESEARCH_SOURCE;
  if(!source && els.editModelModal?.contains(input)){
    const critBox=input.closest('[data-crit]'), filterBox=input.closest('[data-filter]');
    const c=critBox ? getEditCriterion(critBox.dataset.crit) : null;
    const f=(c&&filterBox) ? (c.filters||[]).find(x=>x.id===filterBox.dataset.filter) : null;
    source=(f?.source||c?.customSource||c?.source||'');
  }
  source=source || els.researchSource?.value || els.metricSourceSelect?.value || NONDATED_SOURCE;
  return {source,customSource:source};
}
function isHeaderAutocompleteTarget(elm){
  if(!elm || !elm.matches) return false;
  if(elm.matches('textarea[data-research-expression-input],input[data-filter-expression-input]')) return true;
  const list=elm.getAttribute('list');
  return list==='researchHeaderSuggestions' || list==='metricHeaderSuggestions';
}
function showHeaderSuggestions(input,c){
  if(!input || !c) return;
  const info=expressionTokenInfo(input);
  const menu=ensureHeaderSuggestMenu();
  const defaultSource=c.customSource||c.source||NONDATED_SOURCE;
  const query=info.text||'';
  if(info.mode==='source'){
    const matches=allSourceKeys().map(src=>({src,label:labelSource(src),aliases:sourceAliasTextForHeaderSuggest(src)}))
      .filter(x=>headerSuggestMatches(`${x.label} ${x.src} ${x.aliases}`,query))
      .sort((a,b)=>headerSuggestScore(a.aliases,query,a.src,defaultSource)-headerSuggestScore(b.aliases,query,b.src,defaultSource) || a.label.localeCompare(b.label))
      .slice(0,40);
    if(!matches.length){ hideHeaderSuggestions(); return; }
    menu.innerHTML=`<div class="headerSuggestHelp">Choose a source/page. Shortcuts like <strong>!nondate</strong> and <strong>!date</strong> are supported.</div>`+
      matches.map((x,i)=>`<button type="button" class="headerSuggestItem" data-source-suggest="${esc(x.src)}">${esc(x.label)} <span class="hint">!${esc(x.src)}</span></button>`).join('');
    const rect=input.getBoundingClientRect(); menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-360))+'px'; menu.style.top=Math.min(rect.bottom+4,window.innerHeight-390)+'px'; menu.classList.add('open');
    menu.querySelectorAll('[data-source-suggest]').forEach(btn=>btn.onmousedown=e=>{ e.preventDefault(); const label=labelSource(btn.dataset.sourceSuggest); const v=input.value||''; const insertion=`![${label}].[`; input.value=v.slice(0,info.start)+insertion+v.slice(info.end); const pos=info.start+insertion.length; input.focus(); input.setSelectionRange(pos,pos); input.dispatchEvent(new Event('input',{bubbles:true})); showHeaderSuggestions(input,c); });
    return;
  }
  if((query||'').length<1 && info.mode!=='crossHeader'){ hideHeaderSuggestions(); return; }
  const explicitSource=info.mode==='crossHeader' ? info.source : '';
  const matches=expressionHeaderCandidates(defaultSource,explicitSource,query).slice(0,80);
  if(!matches.length){ hideHeaderSuggestions(); return; }
  window.__headerSuggestCandidates=matches;
  menu.innerHTML=`<div class="headerSuggestHelp">Click a real header/metric to insert it. Dotted headers stay as headers; use <strong>!nondate</strong> or <strong>!date</strong> for categorized databases.</div>`+
    matches.map((h,i)=>`<button type="button" class="headerSuggestItem" data-header-suggest-index="${i}">${esc(h.label)}${h.detail?` <span class="hint">— ${esc(h.detail)}</span>`:''}</button>`).join('');
  const rect=input.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-380))+'px';
  menu.style.top=Math.min(rect.bottom+4,window.innerHeight-390)+'px';
  menu.classList.add('open');
  menu.querySelectorAll('[data-header-suggest-index]').forEach(btn=>btn.onmousedown=e=>{ e.preventDefault(); const item=(window.__headerSuggestCandidates||[])[Number(btn.dataset.headerSuggestIndex)]; insertHeaderIntoExpression(input,info,item,defaultSource); });
}
function globalHeaderAutocompleteHandler(e){
  const input=e.target;
  if(!isHeaderAutocompleteTarget(input)) return;
  showHeaderSuggestions(input,headerAutocompleteContext(input));
}
document.addEventListener('focusin',globalHeaderAutocompleteHandler);
document.addEventListener('keyup',globalHeaderAutocompleteHandler);
document.addEventListener('input',e=>{ if(isHeaderAutocompleteTarget(e.target)) setTimeout(()=>showHeaderSuggestions(e.target,headerAutocompleteContext(e.target)),0); });
document.addEventListener('click',e=>{ if(!e.target.closest?.('#headerSuggestMenu') && !isHeaderAutocompleteTarget(e.target)) hideHeaderSuggestions(); });

function headersForModelSource(model, source){
  if(sourceHasImportedData(source)){ try{return sourceRowsFromStoredAoa(source,model,true).headers||[];}catch(e){return getHeaders(source)||[];} }
  return getHeaders(source)||[];
}
function addHeaderRef(refs, ref){
  ref.expected=plainHeaderName(ref.expected);
  if(!ref.expected || !ref.source) return;
  refs.push(ref);
}
function collectHeaderRefsForModel(model){
  ensureSourceSettings(model);
  const refs=[];
  (model.criteria||[]).forEach(c=>{
    const base={modelId:model.id,modelName:model.name,criterionId:c.id,criterionName:c.name};
    if(c.calcType==='single') addHeaderRef(refs,{...base,kind:'criterion',source:c.source,field:'column',label:'Single column',expected:c.column});
    if(c.calcType==='displayColumn'){
      if(Number(c.lookupVersion)>=2){
        addHeaderRef(refs,{...base,kind:'criterion',source:c.source,field:'lookupMatchColumn',label:'Lookup match column',expected:c.lookupMatchColumn});
        if(c.displayCalculation!=='count') addHeaderRef(refs,{...base,kind:'criterion',source:c.source,field:'lookupReturnColumn',label:'Lookup return column',expected:c.lookupReturnColumn||c.column});
        if(['latest','earliest'].includes(c.lookupSelection)) addHeaderRef(refs,{...base,kind:'criterion',source:c.source,field:'lookupDateColumn',label:'Lookup record date column',expected:c.lookupDateColumn});
      }else addHeaderRef(refs,{...base,kind:'criterion',source:c.source,field:'column',label:'Display column',expected:c.column});
    }
    if(c.calcType==='multi'){
      addHeaderRef(refs,{...base,kind:'criterion',source:c.leftSource,field:'leftColumn',label:'Left column',expected:c.leftColumn});
      addHeaderRef(refs,{...base,kind:'criterion',source:c.rightSource,field:'rightColumn',label:'Right column',expected:c.rightColumn});
    }
    if(c.calcType==='custom') expressionRefsForSource(c.expression,c.customSource||c.source).forEach(ref=>addHeaderRef(refs,{...base,kind:'expression',source:ref.source||ref.sourceLabel,field:'expression',label:'Custom expression',expected:ref.column}));
    if(c.trueValueEnabled) addHeaderRef(refs,{...base,kind:'criterion',source:c.trueValueSource,field:'trueValueColumn',label:'True Value column',expected:c.trueValueColumn});
    if(isRowPullCriterion(c)){
      const checkSrc=rowPullSourceForCriterion(c);
      addHeaderRef(refs,{...base,kind:'criterion',source:checkSrc,field:'checkDateColumn',label:`${labelSource(checkSrc)} date column`,expected:c.checkDateColumn});
      ensureRowPullConditions(c).forEach((cond,idx)=>{
        addHeaderRef(refs,{...base,kind:'criterion',source:checkSrc,field:'checkColumn',label:`${labelSource(checkSrc)} condition ${idx+1} column`,expected:cond.column||c.checkColumn});
        if(cond.connector==='andSeparate') addHeaderRef(refs,{...base,kind:'criterion',source:checkSrc,field:'checkDateColumn',label:`${labelSource(checkSrc)} condition ${idx+1} date column`,expected:cond.dateColumn||c.checkDateColumn});
      });
    }
    (c.filters||[]).forEach(f=>{
      if(f.dynamicColumn && isNumericFilterOperator(f.operator)) expressionRefsForSource(f.columnExpression,f.source||c.source).forEach(ref=>addHeaderRef(refs,{...base,kind:'filterExpression',filterId:f.id,source:ref.source||ref.sourceLabel,field:'columnExpression',label:'Dynamic filter column expression',expected:ref.column}));
      else addHeaderRef(refs,{...base,kind:'filter',filterId:f.id,source:f.source||c.source,field:'column',label:'Filter column',expected:f.column});
      if(f.dynamic && isNumericFilterOperator(f.operator)) expressionRefsForSource(f.expression,f.source||c.source).forEach(ref=>addHeaderRef(refs,{...base,kind:'filterExpression',filterId:f.id,source:ref.source||ref.sourceLabel,field:'expression',label:'Dynamic filter value expression',expected:ref.column}));
      if(['includeWithin','excludeWithin'].includes(f.action||f.mode)){
        addHeaderRef(refs,{...base,kind:'filter',filterId:f.id,source:f.targetSource||'qa',field:'targetDateColumn',label:'Date-aware filter target date column',expected:f.targetDateColumn});
        addHeaderRef(refs,{...base,kind:'filter',filterId:f.id,source:f.targetSource||'qa',field:'targetValueColumn',label:'Date-aware filter target value column',expected:f.targetValueColumn});
      }
    });
  });
  if(modelUsesQA(model)){
    const q=getSourceSetting(model,'qa').columns||{};
    if(q.nameMode==='firstLast'){
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'firstName',label:'QA representative first name column',expected:q.firstName||'First Name'});
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'lastName',label:'QA representative last name column',expected:q.lastName||'Last Name'});
    }else{
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'agent',label:'QA representative column',expected:q.fullName||q.agent||'Agent Name'});
    }
    addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'team',label:'QA team column',expected:q.team||'Team'});
    addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'score',label:'QA score column',expected:q.score||'Score %'});
    addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'interactionDate',label:'QA interaction date column',expected:q.interactionDate||'Interaction Start Time'});
    addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:'qa',fieldKey:'assignedDate',label:'QA assigned date column',expected:q.assignedDate||'Assigned Date'});
  }
  customSourceKeys().forEach(src=>{ const cfg=getSourceSetting(model,src), fw=cfg.framework||sourceFramework(src)||'generic_table', cols=cfg.columns||{}; relevantMappingKeys(src,fw).forEach(key=>addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:src,fieldKey:key,label:`${labelSource(src)} ${SOURCE_MAPPING_LABELS[key]||key}`,expected:cols[key]})); });
  ['checklist','documented_coaching','comp_calls'].forEach(src=>{ if(!(model.criteria||[]).some(c=>c.source===src || (src==='checklist'&&c.calcType==='checklistCount'))) return;
    const cs=getSourceSetting(model,src).columns||{}; const label=labelSource(src);
    const baseCols=SOURCE_SETTING_DEFAULTS[src]?.columns || SOURCE_SETTING_DEFAULTS.checklist.columns || {};
    if(cs.nameMode==='firstLast'){
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:src,fieldKey:'firstName',label:`${label} representative first name column`,expected:cs.firstName||'First Name'});
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:src,fieldKey:'lastName',label:`${label} representative last name column`,expected:cs.lastName||'Last Name'});
    }else{
      addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:src,fieldKey:'rep',label:`${label} representative column`,expected:cs.fullName||cs.rep||baseCols.fullName||baseCols.rep||'Associate Name'});
    }
    addHeaderRef(refs,{modelId:model.id,modelName:model.name,kind:'sourceSetting',source:src,fieldKey:'team',label:`${label} team column`,expected:cs.team||baseCols.team||'Coach Assigned'});
  });
  return refs;
}
function massHeaderChoiceOptions(headers, expected){
  headers=(headers||[]).map(plainHeaderName).filter(Boolean);
  const expectedNorm=norm(expected);
  const sorted=[...headers].sort((a,b)=>{
    const am=norm(a).includes(expectedNorm)?0:1, bm=norm(b).includes(expectedNorm)?0:1;
    return am-bm || a.localeCompare(b);
  });
  return `<option value="">Choose matching header...</option>`+sorted.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
}
function setHeaderReference(ref, newHeader){
  const model=findModel(ref.modelId); if(!model || !newHeader) return false;
  ensureSourceSettings(model);
  if(ref.kind==='sourceSetting'){
    model.sourceSettings[ref.source]=model.sourceSettings[ref.source]||sourceDefaults(ref.source);
    model.sourceSettings[ref.source].columns=model.sourceSettings[ref.source].columns||{};
    model.sourceSettings[ref.source].columns[ref.fieldKey]=newHeader;
  }else{
    const c=(model.criteria||[]).find(x=>x.id===ref.criterionId); if(!c) return false;
    if(ref.kind==='criterion') c[ref.field]=newHeader;
    if(ref.kind==='filter'){
      const f=(c.filters||[]).find(x=>x.id===ref.filterId); if(!f) return false;
      f[ref.field||'column']=newHeader;
    }
    if(ref.kind==='filterExpression'){
      const f=(c.filters||[]).find(x=>x.id===ref.filterId); if(!f) return false;
      const old=String(ref.expected).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const exprField=ref.field==='columnExpression'?'columnExpression':'expression';
      f[exprField]=String(f[exprField]||'').replace(new RegExp(`\\[${old}\\]`,'g'),`[${newHeader}]`);
    }
    if(ref.kind==='expression'){
      const old=String(ref.expected).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      c.expression=String(c.expression||'').replace(new RegExp(`\\[${old}\\]`,'g'),`[${newHeader}]`);
    }
  }
  return true;
}
function renderMassHeaderCheck(){
  if(!els.massHeaderList) return;
  const showAll=!!els.massShowAllHeaders?.checked;
  const refs=[];
  (state.models||[]).forEach(model=>collectHeaderRefsForModel(model).forEach(ref=>{
    const headers=headersForModelSource(model,ref.source);
    const hit=headerMatch(headers,ref.expected);
    refs.push({...ref,headers,hit,missing:!hit,imported:sourceHasImportedData(ref.source)});
  }));
  state.massHeaderRefs=refs;
  const missing=refs.filter(r=>r.missing).length, noData=refs.filter(r=>!r.imported).length, shown=refs.filter(r=>showAll || r.missing || !r.imported);
  if(els.massHeaderSummary) els.massHeaderSummary.textContent=`${missing} missing • ${refs.length} checked${noData?` • ${noData} need imports`:''}`;
  if(!shown.length){ els.massHeaderList.innerHTML='<div class="massHeaderRow ok"><strong>All checked headers are aligned.</strong><div class="massHeaderMeta">No missing expected headers were found for the currently imported files.</div></div>'; return; }
  els.massHeaderList.innerHTML=shown.map(ref=>{
    const idx=refs.indexOf(ref);
    const cls=!ref.imported?'warn':ref.missing?'':'ok';
    const title=ref.imported ? (ref.missing?'Missing header':'Aligned header') : 'No imported file for this source';
    const fix=ref.imported && ref.headers.length ? `<div class="massHeaderFix"><select data-mass-header-choice="${idx}">${massHeaderChoiceOptions(ref.headers,ref.expected)}</select><button class="smallBtn green" data-apply-header="${idx}">Apply</button></div>` : '';
    return `<div class="massHeaderRow ${cls}"><strong>${esc(title)} — ${esc(ref.modelName)}${ref.criterionName?` / ${esc(ref.criterionName)}`:''}</strong><div class="massHeaderMeta"><b>${esc(labelSource(ref.source))}</b> · ${esc(ref.label)} · Expected: <b>${esc(ref.expected)}</b>${ref.hit?` · Found: <b>${esc(ref.hit)}</b>`:''}</div>${fix}</div>`;
  }).join('');
  els.massHeaderList.querySelectorAll('[data-apply-header]').forEach(btn=>btn.onclick=()=>applyOneMassHeaderFix(Number(btn.dataset.applyHeader)));
}
function applyOneMassHeaderFix(index){
  const select=els.massHeaderList?.querySelector(`[data-mass-header-choice="${index}"]`);
  const header=select?.value||'';
  const ref=state.massHeaderRefs[index];
  if(ref && header && setHeaderReference(ref,header)){ saveModels(); renderMassHeaderCheck(); renderEditModelSafe(); }
}
function applyAllMassHeaderFixes(){
  let changed=0;
  els.massHeaderList?.querySelectorAll('[data-mass-header-choice]').forEach(sel=>{
    const idx=Number(sel.dataset.massHeaderChoice), ref=state.massHeaderRefs[idx];
    if(ref && sel.value && setHeaderReference(ref,sel.value)) changed++;
  });
  if(changed){ saveModels(); renderMassHeaderCheck(); renderEditModelSafe(); }
}
function openMassHeaderCheck(){ renderMassHeaderCheck(); openModal('massHeaderModal'); }
function getEditCriterion(cid){return (state.editModel?.criteria||[]).find(c=>c.id===cid);}
function syncModelSourceSettingsFromDom(){
  if(!state.editModel || !els.sourceSettingsPanel) return;
  ensureSourceSettings(state.editModel);
  els.sourceSettingsPanel.querySelectorAll('[data-layout-source]').forEach(input=>{
    const src=input.dataset.layoutSource, field=input.dataset.layoutField;
    state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||sourceDefaults(src);
    state.editModel.sourceSettings[src][field]=Math.max(1,Number(input.value)||1);
  });
  els.sourceSettingsPanel.querySelectorAll('[data-framework-source]').forEach(input=>{
    const src=input.dataset.frameworkSource;
    state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||customSourceDefaultSettings(src);
    state.editModel.sourceSettings[src].framework=input.value;
    const c=customSource(src); if(c) c.framework=input.value;
  });
  els.sourceSettingsPanel.querySelectorAll('[data-qacol-source]').forEach(input=>{
    const src=input.dataset.qacolSource, field=input.dataset.qacolField;
    state.editModel.sourceSettings[src]=state.editModel.sourceSettings[src]||sourceDefaults(src);
    state.editModel.sourceSettings[src].columns=state.editModel.sourceSettings[src].columns||{};
    state.editModel.sourceSettings[src].columns[field]=input.type==='checkbox' ? input.checked : input.value.trim();
  });
}
function syncEditModelFields(){
  if(!state.editModel) return;
  state.editModel.name=els.modelNameInput.value.trim()||'Untitled Model';
  state.editModel.type=els.modelTypeInput.value;
  state.editModel.tiebreaker=els.modelTiebreakerInput.value;
  syncModelSourceSettingsFromDom();
}
function saveEditModel(exit){
  syncEditModelFields();
  const m=normalizeModelForStorage(JSON.parse(JSON.stringify(state.editModel)));
  const badTrue=(m.criteria||[]).find(c=>c.trueValueEnabled && (!TEAM_TOTAL_SOURCE_KEYS.includes(c.trueValueSource)||!plainHeaderName(c.trueValueColumn)));
  if(badTrue){ alert(`True Value settings for ${badTrue.name||'a criterion'} require a Team Totals source and column.`); return; }
  const badDisplay=(m.criteria||[]).find(c=>c.calcType==='displayColumn' && (c.audience==='both' || (Number(c.lookupVersion)>=2 && (!plainHeaderName(c.lookupMatchColumn) || (c.displayCalculation!=='count'&&!plainHeaderName(c.lookupReturnColumn||c.column)) || (c.lookupMatchEntity==='custom'&&!String(c.lookupCustomValue||'').trim()))) || (Number(c.lookupVersion)<2&&!plainHeaderName(c.column))));
  if(badDisplay){ alert(`Lookup / Display settings for ${badDisplay.name||'a criterion'} are incomplete. Select where the entity is found and which value to return. Custom matches also require a custom value.`); return; }
  const saved=upsertModel(m);
  state.editModel=JSON.parse(JSON.stringify(saved));
  state.editOriginalId=saved.id;
  saveModels();
  if(exit) closeModal('editModelModal');
}
function downloadText(filename, text){
  const blob=new Blob([text],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},0);
}
