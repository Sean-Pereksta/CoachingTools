/* Independent chart definitions and an additive analysis board. Uses calculated
 * Research results only: chart edits and exports never execute a Research query.
 * Classic script + dependency-free SVG keep local and portable builds offline. */
(function(root){
  'use strict';
  const VERSION=1, CHARTS_KEY='allstar.researchCharts.v1', BOARD_KEY='allstar.analysisBoard.v1', DRAFT_KEY='allstar.chartDrafts.v1';
  const TYPES=['line','multi-line','bar','grouped-bar','stacked-bar','area','scatter','bubble','histogram','combo','pie','heatmap','box'];
  const COLORS=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#4d7c0f','#475569','#9f1239'];
  const colorForIndex=index=>COLORS[index]||`hsl(${Math.round(index*137.508)%360} 62% 39%)`;
  const references=new Map(), projections=new WeakMap(), draftMemory=new Map(), stats={datasetBuilds:0,datasetHits:0,renders:0};
  let adapters={}, sequence=0;
  const now=()=>root.performance?.now?.()??Date.now();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:(Number.isFinite(Number(value))?Number(value):null);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const makeId=prefix=>prefix+'-'+Date.now().toString(36)+'-'+(++sequence).toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const array=value=>Array.isArray(value)?value:[];
  const calendarDate=label=>/^\d{4}-\d{2}-\d{2}$/.test(label)?finite(Date.parse(label)):null;
  const LINE_LABEL_MODES=[['none','No line labels'],['all','All lines (up to 8)'],['top','Top N by average'],['bottom','Bottom N by average'],['both','Top and bottom N by average']];
  function linePreferences(value={}){
    const mode=LINE_LABEL_MODES.some(([key])=>key===value.endLabelMode)?value.endLabelMode:value.endLabels?'all':'none';
    return {rollingDisplay:value.rollingDisplay==='only'?'only':'overlay',endLabelMode:mode,endLabelCount:Math.max(1,Math.min(8,Math.floor(Number(value.endLabelCount)||1))),endLabels:mode!=='none'};
  }
  function lineLabelCandidates(def,series){
    const prefs=linePreferences(def),hidden=new Set(def.hiddenSeries||[]);
    if(prefs.endLabelMode==='none')return [];
    const candidates=series.filter(s=>!s.derived&&!hidden.has(s.id)).map(s=>{
      const valid=s.points.filter(p=>Number.isFinite(p.value)),target=s.suppressed?series.find(d=>d.parentId===s.id&&d.layerKind==='rolling'&&!hidden.has(d.id)):s;
      return {id:target?.id,parentId:s.id,name:s.displayName||s.name,average:valid.length?valid.reduce((n,p)=>n+p.value,0)/valid.length:null,point:target?.points.filter(p=>Number.isFinite(p.value)).at(-1)};
    }).filter(s=>s.point&&s.average!==null);
    if(prefs.endLabelMode==='all')return candidates.length<=8?candidates:[];
    const tie=(a,b)=>a.name.localeCompare(b.name)||a.parentId.localeCompare(b.parentId),n=prefs.endLabelCount;
    const highest=[...candidates].sort((a,b)=>b.average-a.average||tie(a,b)).slice(0,n),lowest=[...candidates].sort((a,b)=>a.average-b.average||tie(a,b)).slice(0,n);
    return [...new Map((prefs.endLabelMode==='top'?highest:prefs.endLabelMode==='bottom'?lowest:[...highest,...lowest]).map(s=>[s.parentId,s])).values()];
  }
  const bounds=values=>{let min=Infinity,max=-Infinity;for(const value of values){if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}}return {min:min===Infinity?0:min,max:max===-Infinity?1:max};};
  function columnsFor(result){
    let count=array(result.columns).length;
    for(const row of array(result.data).slice(0,100)) count=Math.max(count,array(row.values).length);
    return Array.from({length:count},(_,i)=>({index:i,label:String(result.columns?.[i]?.displayTitle||result.columns?.[i]?.label||result.columns?.[i]?.field||'Measure '+(i+1))}));
  }
  function recommend(item={},result={}){
    const columns=columnsFor(result), labels=array(result.data).slice(0,20).map(row=>String(row.label||''));
    const dated=!!item.groupField&&(item.groupField===item.dateColumn||/\b(date|week|month|quarter)\b/i.test(item.groupField))||!!labels.length&&labels.every(label=>/^\d{4}[-/]\d{1,2}([-/]\d{1,2})?(?:\b|$)|^\d{4}[- ]?Q[1-4]$/.test(label));
    if(item.outputType==='scatter') return 'scatter';
    if(dated) return columns.length>1||result.hasSecondary?'multi-line':'line';
    return columns.length>1||result.hasSecondary?'grouped-bar':'bar';
  }
  function normalize(def={},item={},result={}){
    const cols=columnsFor(result), available=cols.map(c=>c.index),bindings=array(def.columnBindings).filter(b=>Number.isInteger(b?.index)&&typeof b.key==='string');
    const sameSchema=bindings.length===cols.length&&bindings.every(b=>resultColumnKey(result,b.index)===b.key);
    const bindIndex=index=>{
      if(!cols.length||!bindings.length||sameSchema)return index;
      const binding=bindings.find(b=>b.index===index);if(!binding)throw new Error('A chart measure no longer matches this Research result. Create a new chart or restore the original Research columns.');
      const matches=cols.filter(col=>resultColumnKey(result,col.index)===binding.key);
      if(matches.length!==1)throw new Error('A saved chart measure is missing or ambiguous in this Research result. Restore its columns or create a new chart.');
      return matches[0].index;
    };
    const chosen=array(def.y).map(Number).filter(i=>Number.isInteger(i)&&i>=0).map(bindIndex).filter(i=>!cols.length||available.includes(i));
    let x=/^(label|date|xValue|value:\d+)$/.test(def.x||'')?def.x:'label';if(x.startsWith('value:'))x='value:'+bindIndex(Number(x.slice(6)));
    const bubble=Number(def.bubble??-1)>=0?bindIndex(Math.floor(Number(def.bubble))):-1;
    const hiddenSeries=array(def.hiddenSeries).map(value=>{const text=String(value);if(sameSchema||!bindings.length||!cols.length)return text;const match=text.match(/^(\[.*\])(::.*)?$/);if(!match)return text;try{const parts=JSON.parse(match[1]);if(parts.length!==3)return text;parts[2]=bindIndex(parts[2]);return JSON.stringify(parts)+(match[2]||'');}catch(error){return text;}});
    return {
      schemaVersion:VERSION,id:String(def.id||''),researchId:String(def.researchId||item.id||''),name:String(def.name||item.title||'Research chart'),
      type:TYPES.includes(def.type)?def.type:recommend(item,result),x,y:chosen.length?[...new Set(chosen)]:(available.length?available.slice(0,Math.min(4,available.length)):[0]),columnBindings:cols.length?cols.map(col=>({index:col.index,key:resultColumnKey(result,col.index)})):bindings,
      secondary:def.secondary!==false,panel:def.panel!==false,aggregation:['none','sum','avg','min','max','count'].includes(def.aggregation)?def.aggregation:'none',
      sort:['source','labelAsc','labelDesc','valueAsc','valueDesc','dateAsc'].includes(def.sort)?def.sort:'source',topN:Math.max(0,Math.min(100000,Math.floor(Number(def.topN)||0))),
      include:String(def.include||''),exclude:String(def.exclude||''),start:String(def.start||''),end:String(def.end||''),
      title:String(def.title??item.title??'Research chart'),subtitle:String(def.subtitle||''),legend:def.legend!==false,dataLabels:!!def.dataLabels,grid:def.grid!==false,
      xLabel:String(def.xLabel||''),yLabel:String(def.yLabel||''),format:['number','percent','decimal_percent','currency'].includes(def.format)?def.format:(item.showPercent?'percent':'number'),
      decimals:Math.max(0,Math.min(6,Math.floor(Number(def.decimals??item.decimals??1)))),lineWidth:Math.max(1,Math.min(8,Number(def.lineWidth)||3)),points:def.points!==false,fill:!!def.fill,
      average:!!def.average,trend:!!def.trend,target:finite(def.target),rolling:Math.max(0,Math.min(1000,Math.floor(Number(def.rolling)||0))),...linePreferences(def),cumulative:!!def.cumulative,
      previous:!!def.previous,periodLag:Math.max(1,Math.min(1000,Math.floor(Number(def.periodLag)||1))),change:['none','difference','percent'].includes(def.change)?def.change:'none',
      bins:Math.max(2,Math.min(100,Math.floor(Number(def.bins)||10))),bubble,hiddenSeries,
      savedAt:String(def.savedAt||''),resultRenderedAt:String(result.renderedAt||item.renderedResult?.renderedAt||def.resultRenderedAt||'')
    };
  }
  function projectionKey(def){const keys=['type','x','y','secondary','panel','aggregation','sort','topN','include','exclude','start','end','rolling','rollingDisplay','cumulative','previous','periodLag','change','bins','bubble','average','trend','target'];return JSON.stringify(keys.map(k=>def[k]));}
  function format(value,def={}){
    if(value==null||!Number.isFinite(Number(value)))return '—';
    let n=Number(value);if(def.format==='decimal_percent')n*=100;
    const text=n.toLocaleString(undefined,{minimumFractionDigits:Number(def.decimals)||0,maximumFractionDigits:Number(def.decimals)||0});
    return (def.format==='currency'?'$':'')+text+(['percent','decimal_percent'].includes(def.format)?'%':'');
  }
  function tokens(text){return new Set(String(text||'').split(/\n|,/).map(v=>v.trim().toLocaleLowerCase()).filter(Boolean));}
  function aggregate(points,mode){
    const valid=points.map(p=>p.value).filter(Number.isFinite);
    if(mode==='count')return points.length;
    if(!valid.length)return null;
    if(mode==='min'||mode==='max')return bounds(valid)[mode];
    const total=valid.reduce((sum,value)=>sum+value,0);return mode==='avg'?total/valid.length:total;
  }
  function rolling(values,window){
    let sum=0,count=0;return values.map((value,i)=>{if(Number.isFinite(value)){sum+=value;count++;}if(i>=window&&Number.isFinite(values[i-window])){sum-=values[i-window];count--;}return count?sum/count:null;});
  }
  function trendValues(points){
    const valid=points.map((p,i)=>({x:Number.isFinite(p.x)?p.x:i,y:p.value})).filter(p=>Number.isFinite(p.y));
    if(valid.length<2)return points.map(()=>null);
    const origin=valid[0].x,meanX=valid.reduce((n,p)=>n+p.x-origin,0)/valid.length,meanY=valid.reduce((n,p)=>n+p.y,0)/valid.length;
    let numerator=0,denominator=0;for(const p of valid){const x=p.x-origin-meanX;numerator+=x*(p.y-meanY);denominator+=x*x;}
    if(!denominator)return points.map(()=>meanY);
    const slope=numerator/denominator;return points.map((p,i)=>meanY+slope*((Number.isFinite(p.x)?p.x:i)-origin-meanX));
  }
  function correlation(points){
    const valid=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.value)),n=valid.length;if(n<2)return {n,r:null,slope:null};
    const mx=valid.reduce((sum,p)=>sum+p.x,0)/n,my=valid.reduce((sum,p)=>sum+p.value,0)/n;let xx=0,yy=0,xy=0;
    for(const p of valid){const dx=p.x-mx,dy=p.value-my;xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;}
    return {n,r:xx&&yy?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null,slope:xx?xy/xx:null};
  }
  function buildDataset(input={},result={}){
    const def=normalize(input,{},result),key=projectionKey(def);
    let cache=projections.get(result);if(cache?.has(key)){stats.datasetHits++;adapters.onTiming?.('chartDataset',0,'cache hit');return cache.get(key);}
    const started=now(),cols=columnsFor(result),includes=tokens(def.include),excludes=tokens(def.exclude),numeric=['scatter','bubble'].includes(def.type),histogram=def.type==='histogram';
    const warnings=[],seriesMap=new Map(),labelMap=new Map(),start=Date.parse(def.start),end=Date.parse(def.end);
    let rowIndex=0,missing=0,filtered=0;
    for(const row of array(result.data)){
      const label=String(row.label??''),date=calendarDate(label)??finite(row.dateValue),text=label.toLocaleLowerCase();
      const selected=(!includes.size||includes.has(text))&&!excludes.has(text),datePass=(!Number.isFinite(start)||(date!=null&&date>=start))&&(!Number.isFinite(end)||(date!=null&&date<=end+86400000-1));
      if(!selected||!datePass){rowIndex++;filtered++;continue;}
      let x=def.x==='date'?date:def.x==='xValue'?finite(row.xValue):def.x.startsWith('value:')?finite(row.values?.[Number(def.x.slice(6))]):numeric?finite(row.xValue??row.label):label;
      if(numeric&&x==null){rowIndex++;missing++;continue;}
      const category=String(x??label),secondary=def.secondary?String(row.secondary||''):'',panel=def.panel?String(row.panel||''):'';
      for(const columnIndex of def.y){
        const name=[secondary,panel,cols[columnIndex]?.label||'Value'].filter(Boolean).join(' · '),sid=JSON.stringify([secondary,panel,columnIndex]);
        let series=seriesMap.get(sid);if(!series){series={id:sid,name,columnIndex,points:[],buckets:new Map(),occurrences:new Map()};seriesMap.set(sid,series);}
        let occurrence=0;if(def.aggregation==='none'){occurrence=series.occurrences.get(category)||0;series.occurrences.set(category,occurrence+1);}
        const categoryKey=JSON.stringify([category,occurrence]);
        if(!labelMap.has(categoryKey))labelMap.set(categoryKey,{key:categoryKey,label:category,date:date??null,x:numeric?x:null,order:labelMap.size});
        const point={categoryKey,label:category,x:numeric?x:null,value:finite(row.values?.[columnIndex]),radius:finite(def.bubble>=0?row.values?.[def.bubble]:row.rows),refs:[{rowIndex,columnIndex}],date:date??null,detail:row.pointDetails?.[columnIndex]||null,box:row.box||null};
        if(def.aggregation==='none')series.points.push(point);else{if(!series.buckets.has(categoryKey))series.buckets.set(categoryKey,[]);series.buckets.get(categoryKey).push(point);}
      }
      rowIndex++;
    }
    let series=[...seriesMap.values()];
    for(const s of series){
      if(def.aggregation!=='none')s.points=[...s.buckets.values()].map(points=>({...points[0],value:aggregate(points,def.aggregation),refs:points.flatMap(p=>p.refs)}));
      delete s.buckets;delete s.occurrences;
    }
    let labels=[...labelMap.values()];
    if(def.sort!=='source'){
      const totals=new Map();for(const s of series)for(const p of s.points)if(p.value!=null)totals.set(p.categoryKey,(totals.get(p.categoryKey)||0)+p.value);
      const compare=def.sort==='labelAsc'?(a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}):def.sort==='labelDesc'?(a,b)=>b.label.localeCompare(a.label,undefined,{numeric:true}):def.sort==='dateAsc'?(a,b)=>(a.date??Infinity)-(b.date??Infinity):(a,b)=>((totals.get(a.key)||0)-(totals.get(b.key)||0))*(def.sort==='valueDesc'?-1:1);
      labels.sort(compare);
    }
    if(def.topN)labels=labels.slice(0,def.topN);
    const indices=new Map(labels.map((label,index)=>[label.key,index]));
    for(const s of series)s.points=s.points.filter(p=>indices.has(p.categoryKey)).map(p=>({...p,index:indices.get(p.categoryKey)})).sort((a,b)=>a.index-b.index);
    if(histogram){
      const all=series.flatMap(s=>s.points.map(p=>p.value)).filter(Number.isFinite),extent=bounds(all),width=extent.max===extent.min?1:(extent.max-extent.min)/def.bins,origin=extent.max===extent.min?extent.min-.5:extent.min;
      const binCount=extent.max===extent.min?1:def.bins;
      labels=Array.from({length:binCount},(_,i)=>({key:String(i),label:(origin+i*width).toLocaleString(undefined,{maximumFractionDigits:3})+' – '+(origin+(i+1)*width).toLocaleString(undefined,{maximumFractionDigits:3}),order:i}));
      series=series.map(s=>{const points=labels.map((l,i)=>({categoryKey:l.key,label:l.label,value:0,index:i,x:null,refs:[]}));for(const p of s.points)if(p.value!=null){const i=Math.min(binCount-1,Math.max(0,Math.floor((p.value-origin)/width)));points[i].value++;points[i].refs.push(...p.refs);}return {...s,points};});
      warnings.push('Histogram counts calculated result values, not individual source rows.');
    }
    if(def.type==='pie')series=series.flatMap(s=>s.points.map(p=>({...s,id:s.id+'::slice:'+encodeURIComponent(p.categoryKey),name:p.label+(series.length>1?' · '+s.name:''),points:[p]})));
    const analysis=[];
    for(const s of series){
      const byIndex=new Map(s.points.map(p=>[p.index,p]));
      if(!numeric)s.points=labels.map((label,i)=>byIndex.get(i)||({categoryKey:label.key,label:label.label,index:i,x:null,value:null,refs:[],date:label.date}));
      if(def.cumulative){let running=0;s.points=s.points.map(p=>({...p,value:p.value==null?null:(running+=p.value)}));}
      const original=s.points.map(p=>p.value);
      if(def.change!=='none')s.points=s.points.map((p,i)=>{const previous=original[i-def.periodLag],current=p.value;return {...p,value:previous==null||current==null?null:def.change==='percent'?(previous===0?null:(current-previous)/Math.abs(previous)*100):current-previous};});
      const derived=(suffix,values,layerKind)=>analysis.push({id:s.id+'::'+suffix,parentId:s.id,name:s.name+' · '+suffix,columnIndex:s.columnIndex,derived:true,layerKind,points:s.points.map((p,i)=>({...p,value:values[i],refs:[],detail:null}))});
      if(def.rolling>1){derived(def.rolling+'-point average',rolling(s.points.map(p=>p.value),def.rolling).map((v,i)=>def.rollingDisplay==='only'&&s.points[i].value==null?null:v),'rolling');if(def.rollingDisplay==='only'&&['line','multi-line','area','combo'].includes(def.type))s.suppressed=true;}
      if(def.previous){const current=s.points.map(p=>p.value);derived('previous '+def.periodLag+' point'+(def.periodLag===1?'':'s'),current.map((_,i)=>current[i-def.periodLag]??null));}
      if(def.average){const valid=s.points.map(p=>p.value).filter(Number.isFinite),mean=valid.length?valid.reduce((n,v)=>n+v,0)/valid.length:null;derived('average',s.points.map(()=>mean));}
      if(def.trend)derived('trend',trendValues(s.points));
    }
    if(def.target!=null&&labels.length)analysis.push({id:'target',name:'Target',derived:true,columnIndex:-1,points:labels.map((label,i)=>({index:i,label:label.label,categoryKey:label.key,value:def.target,x:label.x??null,refs:[]}))});
    if(missing)warnings.push(missing.toLocaleString()+' result rows have no numeric X value and are omitted from this plot.');
    if(def.aggregation!=='none')warnings.push('Aggregation applies to displayed result values. Use Research for a weighted rate or source-row aggregation.');
    if(def.rolling||def.previous||def.change!=='none')warnings.push('Period calculations use displayed points in the selected sort order; missing calendar periods are not invented.');
    const built={labels,series:[...series,...analysis],baseSeries:series.length,warnings,filtered,sourceRows:array(result.data).length,numeric,histogram,columns:cols,statistics:numeric?series.map(s=>({name:s.name,...correlation(s.points)})):[]};
    built.pointCount=built.series.reduce((sum,s)=>sum+s.points.length,0);
    if(!cache){cache=new Map();projections.set(result,cache);}
    let retained=[...cache.values()].reduce((sum,value)=>sum+(value.pointCount||0),0);
    while(cache.size&&(cache.size>=12||retained+built.pointCount>100000)){const oldest=cache.keys().next().value;retained-=cache.get(oldest).pointCount||0;cache.delete(oldest);}
    cache.set(key,built);
    stats.datasetBuilds++;adapters.onTiming?.('chartDataset',now()-started,'full calculation');return built;
  }
  const seriesColor=(series,data)=>{
    const index=Math.max(0,data.series.findIndex(s=>s.id===(series.parentId||series.id)));
    return series.id==='benchmark'?'#334155':series.id==='target'?'#475569':colorForIndex(index);
  };
  function pointDescription(series,point,def){
    const d=point.detail,lines=[series.displayName||series.name,`${calendarDate(point.label)!=null?'Week / Date':'Group'}: ${point.label}`,`${d?.metric||def.yLabel||'Value'}: ${format(point.value,def)}`];
    if(d?.representatives!=null)lines.push('Representatives included: '+d.representatives);
    if(d?.method==='representative_average')lines.push(d.valueType==='percentage'?'Average of representative rates':'Average of representative results');
    if(d?.method==='weighted_rate')lines.push('Combined opportunity-weighted rate');
    if(d?.method==='unique_representatives')lines.push(`${d.numerator} qualifying / ${d.denominator} eligible representatives`);
    if(d?.numeratorLabel&&d.numerator!=null)lines.push(d.numeratorLabel+': '+format(d.numerator,{decimals:0}));
    if(d?.denominatorLabel&&d.denominator!=null)lines.push(d.denominatorLabel+': '+format(d.denominator,{decimals:0}));
    if(point.box)lines.push('Observations: '+point.box.count,`Range: ${format(point.box.min,def)} – ${format(point.box.max,def)}`,`Q1: ${format(point.box.q1,def)} · Median: ${format(point.box.median,def)} · Q3: ${format(point.box.q3,def)}`);
    if(series.derived)lines.push('Visualization layer from the calculated chart points');
    return lines.join('\n');
  }
  function renderSVG(def,input,options={}){
    const endLabels=['line','multi-line','area','combo'].includes(def.type)?lineLabelCandidates(def,input.series):[];
    const started=now(),width=options.width||1000,height=Math.max(options.height||460,width>=700&&endLabels.length?endLabels.length*18+136:0),left=def.type==='heatmap'?160:86,right=endLabels.length&&width>=700?190:30,top=30,bottom=90,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const hidden=new Set(def.hiddenSeries||[]),visible=input.series.filter(s=>!s.suppressed&&!hidden.has(s.id)&&(!s.parentId||!hidden.has(s.parentId))),numeric=input.numeric;
    const colorFor=s=>seriesColor(s,input),stacked=def.type==='stacked-bar',horizontal=def.horizontal&&['bar','grouped-bar','stacked-bar'].includes(def.type),bars=['bar','grouped-bar','stacked-bar','histogram','combo'].includes(def.type);
    const positive=new Array(input.labels.length).fill(0),negative=new Array(input.labels.length).fill(0),ys=[];
    for(const s of visible)for(const p of s.points)if(p.value!=null){if(stacked&&!s.derived){if(p.value>=0)positive[p.index]+=p.value;else negative[p.index]+=p.value;}else ys.push(p.value);if(def.type==='box'&&p.box)ys.push(p.box.min,p.box.max);}
    if(stacked){for(const value of positive)ys.push(value);for(const value of negative)ys.push(value);}
    const yr=bounds(ys);let min=finite(def.axisMin)??Math.min(0,yr.min),max=finite(def.axisMax)??Math.max(0,yr.max);if(min===max)max=min+1;if(min>max)[min,max]=[max,min];
    const padding=(max-min)*.08;if(finite(def.axisMax)==null)max+=padding;if(min<0&&finite(def.axisMin)==null)min-=padding;
    const xr=bounds(visible.flatMap(s=>s.points.map(p=>p.x))),xMin=xr.min,xMax=xr.max===xr.min?xr.max+1:xr.max;
    const y=value=>top+plotHeight-(value-min)/(max-min)*plotHeight,step=plotWidth/Math.max(1,input.labels.length),x=point=>numeric?left+(point.x-xMin)/(xMax-xMin)*plotWidth:left+step*(point.index+.5);
    const axisFormat=input.histogram?{...def,format:'number',decimals:0}:def.change==='percent'?{...def,format:'percent'}:def;
    let grid='',labels='',marks='',clipped=false;
    const endPositions=new Map();
    if(right===190){const ends=[...endLabels].sort((a,b)=>y(a.point.value)-y(b.point.value)),gap=Math.min(18,(plotHeight-16)/Math.max(1,ends.length-1));let prior=top-gap;for(const end of ends){end.y=Math.max(prior+gap,Math.min(height-bottom-8,y(end.point.value)));prior=end.y;}const overflow=Math.max(0,prior-(height-bottom-8));for(const end of ends)endPositions.set(end.id,{...end,y:end.y-overflow});}
    const pointAttrs=(series,p,pi)=>`data-chart-series="${escape(series.id)}" data-chart-point="${pi}" tabindex="0" role="button" aria-label="${escape(pointDescription(series,p,axisFormat))}" ${options.pointAttributes?.(series,p,pi)||''}`;
    const pointTitle=(series,p)=>`<title>${escape(pointDescription(series,p,axisFormat))}</title>`;
    const wrapSeries=(series,content)=>`<g data-chart-line="${escape(series.id)}" data-chart-parent="${escape(series.parentId||series.id)}">${content}</g>`;
    if(def.type==='pie'){
      const entries=visible.flatMap(s=>s.points.map((p,i)=>({s,p,i}))).filter(({p})=>p.value>0),total=entries.reduce((n,{p})=>n+p.value,0),cx=width/2,cy=(height-40)/2,r=Math.min(height*.39,width*.3);let angle=-Math.PI/2;
      for(const {s,p,i} of entries){const next=angle+p.value/total*2*Math.PI,path=entries.length===1?`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colorFor(s)}" ${pointAttrs(s,p,i)}>${pointTitle(s,p)}</circle>`:`<path d="M ${cx} ${cy} L ${cx+r*Math.cos(angle)} ${cy+r*Math.sin(angle)} A ${r} ${r} 0 ${next-angle>Math.PI?1:0} 1 ${cx+r*Math.cos(next)} ${cy+r*Math.sin(next)} Z" fill="${colorFor(s)}" stroke="#fff" stroke-width="2" ${pointAttrs(s,p,i)}>${pointTitle(s,p)}</path>`;marks+=wrapSeries(s,path);angle=next;}
    }else if(horizontal){
      const valueX=v=>left+(v-min)/(max-min)*plotWidth,slotH=plotHeight/Math.max(1,input.labels.length),base=visible.filter(s=>!s.derived),slots=Math.max(1,base.length),pos=new Array(input.labels.length).fill(0),neg=new Array(input.labels.length).fill(0);
      for(let i=0;i<=5;i++){const value=min+(max-min)*i/5,px=valueX(value);grid+=(def.grid?`<line x1="${px}" x2="${px}" y1="${top}" y2="${height-bottom}" stroke="#e2e8f0"/>`:'')+`<text x="${px}" y="${height-bottom+24}" text-anchor="middle" font-size="12">${escape(format(value,axisFormat))}</text>`;}
      input.labels.forEach((l,i)=>{labels+=`<text x="${left-8}" y="${top+slotH*(i+.5)+4}" text-anchor="end" font-size="11"><title>${escape(l.label)}</title>${escape(l.label.length>14?l.label.slice(0,13)+'…':l.label)}</text>`;});
      for(const s of visible){let content='';if(s.derived){const value=s.points.find(p=>p.value!=null)?.value;if(value!=null)content=`<line x1="${valueX(value)}" x2="${valueX(value)}" y1="${top}" y2="${height-bottom}" stroke="${colorFor(s)}" stroke-dasharray="7 5"/>`;}else for(const [i,p] of s.points.entries()){if(p.value==null)continue;let start=0;if(stacked){start=p.value>=0?pos[p.index]:neg[p.index];if(p.value>=0)pos[p.index]+=p.value;else neg[p.index]+=p.value;}const h=slotH*.8/(stacked?1:slots),py=top+p.index*slotH+slotH*.1+(stacked?0:base.indexOf(s)*h);content+=`<rect x="${Math.min(valueX(start),valueX(start+p.value))}" y="${py}" width="${Math.max(.5,Math.abs(valueX(start+p.value)-valueX(start)))}" height="${h*.92}" fill="${colorFor(s)}" ${pointAttrs(s,p,i)}>${pointTitle(s,p)}</rect>`;}marks+=wrapSeries(s,content);}
    }else{
      if(def.type!=='heatmap')for(let i=0;i<=5;i++){const value=min+(max-min)*i/5,py=y(value);grid+=(def.grid?`<line x1="${left}" y1="${py}" x2="${width-right}" y2="${py}" stroke="#e2e8f0"/>`:'')+`<text x="${left-9}" y="${py+4}" text-anchor="end" font-size="12" fill="#475569">${escape(format(value,axisFormat))}</text>`;}
      if(numeric){for(let i=0;i<=5;i++){const value=xMin+(xMax-xMin)*i/5;labels+=`<text x="${left+plotWidth*i/5}" y="${height-bottom+23}" text-anchor="middle" font-size="12" fill="#475569">${escape(value.toLocaleString(undefined,{maximumFractionDigits:2}))}</text>`;}}
      else {const every=Math.max(1,Math.ceil(input.labels.length/Math.max(2,Math.min(12,Math.floor(plotWidth/75)))));input.labels.forEach((label,i)=>{if(i%every!==0&&i!==input.labels.length-1)return;const px=left+step*(i+.5),short=label.label.length>23?label.label.slice(0,22)+'…':label.label;labels+=`<text x="${px}" y="${height-bottom+17}" transform="rotate(-25 ${px} ${height-bottom+17})" text-anchor="end" font-size="11" fill="#475569"><title>${escape(label.label)}</title>${escape(short)}</text>`;});}
      const barSeries=visible.filter((s,i)=>!s.derived&&bars&&(def.type!=='combo'||i===0)),barSlots=Math.max(1,barSeries.length),pos=new Array(input.labels.length).fill(0),neg=new Array(input.labels.length).fill(0);
      const pointBudget=options.capture?Infinity:Math.min(1000,Math.max(50,Math.floor(2500/Math.max(1,visible.length))));
      for(const series of visible){
        const color=colorFor(series),isBar=barSeries.includes(series),stride=Math.max(1,Math.ceil(series.points.length/pointBudget)),shown=series.points.map((p,i)=>({p,i})).filter(({i,p})=>i%stride===0||i===series.points.length-1||p.value==null);if(stride>1)clipped=true;
        let content='';
        if(def.type==='heatmap'){
          const row=visible.indexOf(series),h=plotHeight/Math.max(1,visible.length);labels+=`<text x="${left-9}" y="${top+h*(row+.5)+4}" text-anchor="end" font-size="11">${escape(series.displayName||series.name)}</text>`;
          for(const {p,i} of shown){if(p.value==null)continue;const shade=Math.round(94-55*(p.value-yr.min)/(yr.max-yr.min||1));content+=`<rect x="${left+p.index*step+1}" y="${top+row*h+1}" width="${Math.max(1,step-2)}" height="${Math.max(1,h-2)}" fill="hsl(211 68% ${shade}%)" ${pointAttrs(series,p,i)}>${pointTitle(series,p)}</rect>`;}
        }else if(def.type==='box'&&!series.derived){
          for(const {p,i} of shown){if(!p.box?.count)continue;const b=p.box,px=x(p),w=Math.min(40,step*.6),attrs=pointAttrs(series,p,i);content+=`<g ${attrs}>${pointTitle(series,p)}<line x1="${px}" x2="${px}" y1="${y(b.min)}" y2="${y(b.max)}" stroke="${color}"/><rect x="${px-w/2}" y="${y(b.q3)}" width="${w}" height="${Math.max(1,y(b.q1)-y(b.q3))}" fill="${color}" fill-opacity=".22" stroke="${color}"/><path d="M ${px-w/2} ${y(b.median)} H ${px+w/2} M ${px-w/3} ${y(b.min)} H ${px+w/3} M ${px-w/3} ${y(b.max)} H ${px+w/3}" stroke="${color}" stroke-width="2"/></g>`;}
        }else if(isBar){
          for(const {p,i} of shown){if(p.value==null)continue;const slot=barSeries.indexOf(series),bw=Math.max(.8,step*.78/(stacked?1:barSlots)),bx=left+p.index*step+step*.11+(stacked?0:slot*bw);let base=0;if(stacked){base=p.value>=0?pos[p.index]:neg[p.index];if(p.value>=0)pos[p.index]+=p.value;else neg[p.index]+=p.value;}const by=Math.min(y(base),y(base+p.value)),bh=Math.abs(y(base)-y(base+p.value));content+=`<rect x="${bx}" y="${by}" width="${bw*.92}" height="${Math.max(.5,bh)}" rx="2" fill="${color}" ${pointAttrs(series,p,i)}>${pointTitle(series,p)}</rect>`;if(def.dataLabels&&series.points.length<=60)content+=`<text x="${bx+bw/2}" y="${p.value>=0?by-5:by+bh+14}" text-anchor="middle" font-size="11" fill="${color}">${escape(format(p.value,axisFormat))}</text>`;}
        }else if(numeric&&!series.derived){
          for(const {p,i} of shown){if(p.value==null)continue;const radius=def.type==='bubble'?Math.max(3,Math.min(24,Math.sqrt(Math.max(0,p.radius??1))*2)):4;content+=`<circle cx="${x(p)}" cy="${y(p.value)}" r="${radius}" fill="${color}" fill-opacity=".7" ${pointAttrs(series,p,i)}>${pointTitle(series,p)}</circle>`;}
        }else{
          let path='',segment=[],segments=[];
          for(const {p,i} of shown){if(p.value==null){if(segment.length)segments.push(segment);segment=[];continue;}segment.push({p,i});}if(segment.length)segments.push(segment);
          for(const points of segments){path+='M '+points.map(({p})=>x(p)+','+y(p.value)).join(' L ')+' ';if((def.type==='area'||def.fill)&&!series.derived){const first=points[0].p,last=points[points.length-1].p;content+=`<path d="M ${x(first)},${y(0)} L ${points.map(({p})=>x(p)+','+y(p.value)).join(' L ')} L ${x(last)},${y(0)} Z" fill="${color}" fill-opacity=".1"/>`;}}
          content+=`<path data-chart-path="${escape(series.id)}" d="${path}" fill="none" stroke="${color}" stroke-width="${def.lineWidth}"${series.derived&&!(series.layerKind==='rolling'&&def.rollingDisplay==='only')?' stroke-dasharray="7 5"':''}/>`;
          if(!options.capture)content+=`<path data-chart-hit="${escape(series.id)}" d="${path}" fill="none" stroke="transparent" stroke-width="12" style="cursor:pointer" tabindex="0" role="button" aria-label="Select ${escape(series.displayName||series.name)}"/>`;
          for(const {p,i} of shown){if(p.value==null)continue;const marker=def.points&&visible.length<=8&&!series.derived;content+=`<circle cx="${x(p)}" cy="${y(p.value)}" r="${marker?3.5:6}" fill="${color}" fill-opacity="${marker?1:0}" ${pointAttrs(series,p,i)}>${pointTitle(series,p)}</circle>`;if(def.dataLabels&&series.points.length<=60&&visible.length<=6)content+=`<text x="${x(p)}" y="${y(p.value)-9}" text-anchor="middle" font-size="11" fill="${color}">${escape(format(p.value,axisFormat))}</text>`;}
          if(endPositions.has(series.id)){const end=endPositions.get(series.id),ranked=['top','bottom','both'].includes(linePreferences(def).endLabelMode),last=end.point,value=(ranked?'avg ':'')+format(ranked?end.average:last.value,axisFormat),name=end.name,limit=Math.max(8,Math.floor((right-25)/7)-value.length-1),short=name.length>limit?name.slice(0,limit-1)+'…':name,py=end.y,px=width-right+14;content+=`<path d="M ${x(last)} ${y(last.value)} L ${px-4} ${py}" stroke="${color}" stroke-width=".8" fill="none"/><text data-chart-end-label="${escape(end.parentId)}" x="${px}" y="${py+4}" fill="${color}" font-size="12"><title>${escape(name+' '+value)}</title>${escape(short+' '+value)}</text>`;}
        }
        marks+=wrapSeries(series,content);
      }
    }
    const summary=!visible.length?'All series are hidden. Choose Show All or select a series.':!visible.some(s=>s.points.some(p=>p.value!=null))?'No numeric values match this view.':'';
    const axes=def.type==='pie'?'':`<line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" stroke="#94a3b8"/><text x="${left+plotWidth/2}" y="${height-7}" text-anchor="middle" font-size="13" fill="#334155">${escape(def.xLabel)}</text><text transform="translate(16 ${top+plotHeight/2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#334155">${escape(def.yLabel||(input.histogram?'Count of result values':''))}</text>`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="asc-svg" role="img" aria-label="${escape(def.title||'Research chart')}" font-family="Arial, sans-serif"><title>${escape(def.title)}</title><desc>${escape(summary||visible.length+' series. Select a point to inspect its values.')}</desc><rect width="${width}" height="${height}" fill="#fff"/>${grid}${axes}${labels}${marks}${summary?`<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#475569" font-size="17">${escape(summary)}</text>`:''}</svg>`;
    stats.renders++;adapters.onTiming?.('chartRender',now()-started,'render only');
    return {svg,width,height,clipped,seriesClipped:false,legend:input.series.filter(s=>!s.suppressed).map(s=>({id:s.id,parentId:s.parentId,name:s.displayName||s.name,color:colorFor(s),hidden:hidden.has(s.id)||!!s.parentId&&hidden.has(s.parentId),derived:!!s.derived,solid:s.layerKind==='rolling'&&def.rollingDisplay==='only'}))};
  }
  // Session visualization state is deliberately separate from Research definitions.
  // Every operation below consumes a calculated result, never a source-row adapter.
  const VIEW_KEY='allstar.researchChartViews.v1',viewerSessions=new Map();
  const VIEW_TYPES=['line','bar','scatter','histogram','pie','heatmap','box'];
  function supportsViewer(item){return !item.datedStats&&VIEW_TYPES.includes(item.outputType)&&item.guidedDisplay!=='summary_cards';}
  function viewerPreferences(value={}){
    return {hiddenSeries:array(value.hiddenSeries).map(String),selectedSeries:String(value.selectedSeries||''),selectedPoint:value.selectedPoint||null,trendMode:['off','selected','all'].includes(value.trendMode)?value.trendMode:'off',rolling:[0,2,3,4,6,8,12].includes(Number(value.rolling))?Number(value.rolling):0,...linePreferences(value),benchmark:['off','organization','visible','overall'].includes(value.benchmark)?value.benchmark:'off',targetEnabled:!!value.targetEnabled,target:finite(value.target),previous:!!value.previous,window:['all','4','8','12','custom'].includes(value.window)?value.window:'all',start:String(value.start||''),end:String(value.end||''),legendQuery:String(value.legendQuery||''),panelCollapsed:!!value.panelCollapsed,captureLayout:['standard','wide','presentation'].includes(value.captureLayout)?value.captureLayout:'standard'};
  }
  function viewerDefinition(item,result){
    const context=array(result.data).flatMap(r=>array(r.pointDetails)).find(d=>d?.method),type=item.outputType==='histogram'?'bar':item.outputType==='bar'?(item.stackedBars?'stacked-bar':result.hasSecondary?'grouped-bar':'bar'):item.outputType;
    const def=normalize({type,y:[0],title:item.title,x:item.outputType==='scatter'?'xValue':'label',secondary:true,sort:item.outputType==='line'&&(!item.graphSort||item.graphSort==='inherit')&&(!item.sort||item.sort==='default')?'dateAsc':'source',xLabel:item.outputType==='scatter'?(item.groupField||'X value'):item.dateGrouping==='weekly'||/^weekly/i.test(item.source)?'Week':item.groupField||'Group',yLabel:context?.metric||columnsFor(result)[0]?.label||'Value',format:item.showPercent||context?.valueType==='percentage'||result.columns?.[0]?.showAsPercent?'percent':'number',lineWidth:1.8,points:item.useDots!==false,grid:item.showGridlines!==false},item,result);
    return {...def,...(item.outputType==='histogram'?{format:'number',yLabel:'Count'}:{}),horizontal:item.barOrientation==='horizontal',axisMin:item.axisMin,axisMax:item.axisMax};
  }
  function viewerSession(item,result){
    const key=String(item.id||register(item,result));let session=viewerSessions.get(key);
    if(!session){let defaults;try{defaults=readStore(VIEW_KEY,'views').views.find(v=>v.researchId===key)?.preferences;}catch(_){/* Bad optional defaults never block an existing chart. */}
      session={key,preferences:viewerPreferences(defaults||{target:item.goalValue,targetEnabled:finite(item.goalValue)!=null}),views:new Set()};viewerSessions.set(key,session);
    }
    if(session.result!==result||session.item!==item){session.item=item;session.result=result;session.chartResult=adapters.prepareResult?.(item,result)||result;session.definition=viewerDefinition(item,result);}
    for(const view of session.views)if(!view.host.isConnected){view.dispose?.();session.views.delete(view);}
    while(viewerSessions.size>96){const oldest=[...viewerSessions.values()].find(s=>![...s.views].some(v=>v.host.isConnected));if(!oldest)break;viewerSessions.delete(oldest.key);}
    return session;
  }
  function calculationCaption(item,result){
    const detail=array(result.data).flatMap(r=>array(r.pointDetails)).find(d=>d?.method),weekly=item.dateGrouping==='weekly'||/^weekly/i.test(item.source),parts=[weekly?'Weekly':item.dateGrouping==='monthly'?'Monthly':'Calculated results'];
    const knownRate=/(?:cash|consumer|insurance|commercial)_appointment_rate|appointment rate/i.test(String(item.measureId||item.valueField||''));
    const method=detail?.method||(knownRate?(item.groupAggregation==='weighted'?'weighted_rate':'representative_average'):item.percentBuilder?.unit==='unique_reps'&&item.valueMode==='percent'?'unique_representatives':'result');
    if(method==='representative_average')parts.push(detail?.valueType==='percentage'||item.valueMode==='measure'?'Average of representative rates':'Average of representative results');
    else if(method==='weighted_rate')parts.push('Combined opportunity-weighted rate');
    else if(method==='unique_representatives')parts.push('Percentage of unique representatives');
    else if(method==='representative_total')parts.push('Total of representative results');
    return parts.join(' · ');
  }
  function pointAverage(points,requireContext=false){
    const valid=points.filter(p=>Number.isFinite(p.value));if(!valid.length)return null;
    const methods=new Set(valid.map(p=>p.detail?.method||'result'));
    if(requireContext&&valid.some(p=>!p.detail||p.detail.method==='result'))return null;
    if(methods.size!==1)return null;
    const method=[...methods][0];
    if(method==='representative_average'){const count=valid.reduce((n,p)=>n+(p.detail.count||0),0);return count?valid.reduce((n,p)=>n+(p.detail.sum||0),0)/count:null;}
    if(method==='weighted_rate'||method==='unique_representatives'){const den=valid.reduce((n,p)=>n+(p.detail.denominator||0),0);return den?valid.reduce((n,p)=>n+(p.detail.numerator||0),0)/den*100:null;}
    return valid.reduce((n,p)=>n+p.value,0)/valid.length;
  }
  function weeklyMovingAverage(points,weeks){
    if(!points.every(p=>Number.isFinite(p.date)))return rolling(points.map(p=>p.value),weeks).map((v,i)=>points[i].value==null?null:v);
    const ordered=points.map((p,index)=>({...p,index})).sort((a,b)=>a.date-b.date),values=new Array(points.length).fill(null);let first=0,sum=0,count=0;
    for(let i=0;i<ordered.length;i++){const p=ordered[i];if(p.value!=null){sum+=p.value;count++;}while(first<i&&ordered[first].date<=p.date-weeks*7*86400000){if(ordered[first].value!=null){sum-=ordered[first].value;count--;}first++;}values[p.index]=p.value==null||!count?null:sum/count;}
    return values;
  }
  function viewerDataset(session){
    const prefs=session.preferences,base=session.definition,result=session.chartResult,all=buildDataset(base,result);let start=prefs.start,end=prefs.end;
    if(prefs.window!=='custom'){start='';end='';const dates=all.labels.map(l=>l.date).filter(Number.isFinite);if(prefs.window!=='all'&&dates.length){const last=Math.max(...dates);start=new Date(last-(Number(prefs.window)-1)*7*86400000).toISOString().slice(0,10);end=new Date(last).toISOString().slice(0,10);}}
    const raw=buildDataset({...base,start,end},result),hidden=new Set(prefs.hiddenSeries);
    const windowSeries=new Map(raw.series.map(s=>[s.id,s]));
    let series=all.series.filter(s=>!s.derived).map(s=>({...s,...(windowSeries.get(s.id)||{points:raw.labels.map((l,i)=>({categoryKey:l.key,label:l.label,index:i,date:l.date,x:null,value:null,refs:[]}))}),displayName:s.name.replace(raw.columns.length===1?' · '+raw.columns[0].label:'\0','')}));
    const visible=series.filter(s=>!hidden.has(s.id)),selected=prefs.selectedSeries,analysis=[],timeSeries=['line','multi-line','area','combo'].includes(base.type);
    const rollingOnly=timeSeries&&prefs.rolling>1&&prefs.rollingDisplay==='only';
    const addLayer=(s,name,values,layerKind)=>analysis.push({layerKind,id:s.id+'::'+name,parentId:s.id,name:(s.displayName||s.name)+' · '+name,displayName:(s.displayName||s.name)+' · '+name,derived:true,columnIndex:s.columnIndex,points:s.points.map((p,i)=>({...p,value:values[i],detail:null,refs:[]}))});
    if(timeSeries)for(const s of visible){
      if(prefs.trendMode==='all'||prefs.trendMode==='selected'&&s.id===selected)addLayer(s,'linear trend',trendValues(s.points.map(p=>({...p,x:p.date??p.index}))));
      if(prefs.rolling>1&&(rollingOnly||!selected||s.id===selected))addLayer(s,prefs.rolling+(s.points.every(p=>Number.isFinite(p.date))?'-week':'-point')+' moving average',weeklyMovingAverage(s.points,prefs.rolling),'rolling');
      if(prefs.previous){const byDate=new Map(s.points.filter(p=>Number.isFinite(p.date)).map(p=>[p.date,p.value]));addLayer(s,'previous week',s.points.map(p=>byDate.get(p.date-7*86400000)??null));}
    }
    const requireContext=array(result.data).some(r=>['representative_average','weighted_rate','unique_representatives'].includes(r.pointDetails?.[0]?.method))||/(?:cash|consumer|insurance|commercial)_appointment_rate|appointment rate/i.test(String(session.item.measureId||session.item.valueField||''))||session.item.valueMode==='percent'&&session.item.percentBuilder?.unit==='unique_reps';
    const points=visible.flatMap(s=>s.points),mean=pointAverage(points,requireContext),benchmarkSeries=prefs.benchmark==='organization'?series:visible,benchmarkPoints=benchmarkSeries.flatMap(s=>s.points),benchmarkMean=pointAverage(benchmarkPoints,requireContext),canBenchmark=benchmarkPoints.some(p=>p.value!=null)&&benchmarkMean!=null;
    let benchmarkNote='';
    if(prefs.benchmark!=='off'&&benchmarkSeries.length){
      if(!canBenchmark)benchmarkNote='The saved result lacks the calculation context needed for this benchmark. Run Research once to save it.';
      else {const name=prefs.benchmark==='organization'?'Organization average':prefs.benchmark==='visible'?'Visible population average':'Overall visible average',values=raw.labels.map((_,i)=>prefs.benchmark==='overall'?benchmarkMean:pointAverage(benchmarkSeries.map(s=>s.points[i]).filter(Boolean),requireContext));analysis.push({id:'benchmark',name,displayName:name,derived:true,columnIndex:0,points:raw.labels.map((l,i)=>({index:i,label:l.label,categoryKey:l.key,date:l.date,value:values[i],refs:[],detail:null}))});}
    }
    if(prefs.targetEnabled&&prefs.target!=null&&raw.labels.length)analysis.push({id:'target',name:'Goal: '+format(prefs.target,base),displayName:'Goal: '+format(prefs.target,base),derived:true,columnIndex:-1,points:raw.labels.map((l,i)=>({index:i,label:l.label,categoryKey:l.key,date:l.date,value:prefs.target,refs:[]}))});
    const def={...base,...linePreferences(prefs),hiddenSeries:prefs.hiddenSeries},data={...raw,series:[...series.map(s=>rollingOnly?{...s,suppressed:true}:s),...analysis],baseSeries:series.length};
    const latest=visible.map(s=>s.points.filter(p=>Number.isFinite(p.value)).at(-1)).filter(Boolean).map(p=>p.value),dates=raw.labels.map(l=>l.date).filter(Number.isFinite).sort((a,b)=>a-b);
    const timeframe=dates.length?new Date(dates[0]).toISOString().slice(0,10)+' – '+new Date(dates.at(-1)).toISOString().slice(0,10):'';
    return {def,data,allSeries:series,visible,mean,benchmarkNote,canBenchmark,timeSeries,timeframe,subtitle:calculationCaption(session.item,result)+(rollingOnly?' · Rolling average only ('+prefs.rolling+' '+(series.every(s=>s.points.every(p=>Number.isFinite(p.date)))?'weeks':'points')+')':''),population:array(session.item.populationScope?.includeOrgs).join(', '),summary:{visible:visible.length,total:series.length,periods:raw.labels.length,highest:latest.length?Math.max(...latest):null,lowest:latest.length?Math.min(...latest):null,average:mean}};
  }
  function wrapCaptureText(text,limit){
    const lines=[];let rest=String(text||'');while(rest.length>limit){let cut=rest.lastIndexOf(' ',limit);if(cut<limit/3)cut=limit;lines.push(rest.slice(0,cut));rest=rest.slice(cut).trimStart();}lines.push(rest);return lines;
  }
  function captureSurface(def,data,context={},layout='standard'){
    const width=layout==='standard'?1200:1600,chartHeight=layout==='standard'?500:layout==='wide'?520:570,padding=40;
    const drawing=renderSVG({...def,legend:true},data,{width:width-padding*2,height:chartHeight,capture:true});
    const legend=drawing.legend.filter(l=>!l.hidden),cols=layout==='standard'?3:4,colWidth=(width-padding*2)/cols,fontSize=15,lineHeight=21,limit=Math.floor((colWidth-34)/(fontSize*.62));
    const title=wrapCaptureText(def.title||'Research chart',Math.floor((width-padding*2)/17)),subtitle=wrapCaptureText([context.subtitle||def.subtitle,context.population,context.timeframe].filter(Boolean).join(' · '),Math.floor((width-padding*2)/9));
    const chartTop=padding+title.length*32+subtitle.length*23+16,legendTop=chartTop+chartHeight+22;let y=legendTop,legendMarkup='';
    for(let index=0;index<legend.length;index+=cols){const row=legend.slice(index,index+cols).map(l=>({...l,lines:wrapCaptureText(l.name,limit)})),rowHeight=Math.max(...row.map(l=>l.lines.length))*lineHeight+14;row.forEach((l,col)=>{const x=padding+col*colWidth;legendMarkup+=`<g data-capture-series="${escape(l.id)}"><line x1="${x}" x2="${x+19}" y1="${y+7}" y2="${y+7}" stroke="${l.color}" stroke-width="3"${l.derived&&!l.solid?' stroke-dasharray="5 3"':''}/><text x="${x+27}" y="${y+12}" font-size="${fontSize}" fill="#334155">${l.lines.map((line,i)=>`<tspan x="${x+27}" dy="${i?lineHeight:0}">${escape(line)}</tspan>`).join('')}</text></g>`;});y+=rowHeight;}
    const height=Math.max(layout==='presentation'?900:0,y+padding),titleText=title.map((line,i)=>`<text x="${padding}" y="${padding+25+i*32}" font-size="27" font-weight="700" fill="#0f172a">${escape(line)}</text>`).join(''),subtitleText=subtitle.map((line,i)=>`<text x="${padding}" y="${padding+title.length*32+17+i*23}" font-size="17" fill="#475569">${escape(line)}</text>`).join('');
    const chart=drawing.svg.replace('<svg ',`<svg x="${padding}" y="${chartTop}" width="${width-padding*2}" height="${chartHeight}" `).replace(/ (?:data-chart-[\w-]+|tabindex|role|aria-label)="[^"]*"/g,'');
    return {width,height,legend,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial, sans-serif"><rect width="${width}" height="${height}" fill="white"/>${titleText}${subtitleText}${chart}${legendMarkup}</svg>`};
  }
  async function copyOrDownloadCapture(capture,title,copyImage){
    const blob=await imageBlob(capture.svg);if(copyImage&&root.navigator?.clipboard?.write&&root.ClipboardItem){try{await root.navigator.clipboard.write([new root.ClipboardItem({'image/png':blob})]);return 'Chart image copied.';}catch(_){/* Browser clipboard denial still produces a usable PNG. */}}
    download(safeFilename(title)+'.png',blob,'image/png');return copyImage?'PNG downloaded. Image clipboard is unavailable in this browser.':'Chart PNG downloaded.';
  }
  function viewerHTML(item,result){const key=register(item,result);viewerSession(item,result);return `<div class="asc-viewer" data-asc-viewer="${escape(key)}"></div>`;}
  function refreshViewer(session){for(const view of session.views){if(!view.host.isConnected){view.dispose?.();session.views.delete(view);continue;}view.paint();}}
  function saveViewerDefaults(session){
    const record=readStore(VIEW_KEY,'views'),preferences={...session.preferences,selectedPoint:null,legendQuery:''};record.views=record.views.filter(v=>v.researchId!==session.key);record.views.push({researchId:session.key,preferences});writeStore(VIEW_KEY,record);
  }
  function mountViewer(host,session,fullscreen=false){
    if(host._ascViewer?.session===session)return host._ascViewer;
    const prefs=session.preferences,view={host,session,fullscreen};host._ascViewer=view;session.views.add(view);host.classList.add('asc-viewer');host.classList.toggle('asc-viewer-full',fullscreen);
    const setting=html=>html.replace(/data-setting=/g,'data-v-setting=');
    host.innerHTML=`<div class="asc-view-context"><p data-v-subtitle></p><small data-v-context></small>${fullscreen?'<button type="button" class="asc-panel-toggle" data-v-panel-toggle aria-label="Collapse series and analysis panel" aria-expanded="true">‹</button>':''}</div><div class="asc-view-layout"><main class="asc-view-main"><div class="asc-view-plot"><div data-v-svg></div><div class="asc-point-tooltip" data-v-tooltip role="tooltip" hidden></div></div><div class="asc-point-detail" data-v-detail hidden></div>${fullscreen?'<div class="asc-view-summary" data-v-summary aria-live="polite"></div>':''}</main><aside class="asc-view-panel" aria-label="Series and visualization options"><section class="asc-series-panel"><div class="asc-series-heading"><strong>Series</strong><small data-v-count></small></div><div class="asc-series-tools"><input type="search" data-v-search placeholder="Find coach or representative…" aria-label="Find coach or representative"><div><button type="button" data-v-show>Show All</button><button type="button" data-v-hide>Hide All</button></div></div><div class="asc-series-list" data-v-legend></div></section>${fullscreen?`<section class="asc-view-layers"><h3>Analysis layers</h3><div data-v-time-tools>${setting(selectField('trendMode','Trend',[['off','Off'],['selected','Selected series'],['all','All visible series']],prefs.trendMode))}${setting(selectField('rolling','Moving average',[['0','Off'],['2','2 weeks'],['3','3 weeks'],['4','4 weeks'],['6','6 weeks'],['8','8 weeks'],['12','12 weeks']],prefs.rolling))}${setting(selectField('rollingDisplay','Line display',[['overlay','Original + rolling average'],['only','Rolling average only']],prefs.rollingDisplay))}<small class="asc-hint">Rolling-only smooths every visible line. Overlay follows the focused line, or all visible lines if none is focused. Missing points remain gaps; partial starting windows use available values.</small>${setting(checkField('previous','Compare with previous week',prefs.previous))}</div>${setting(selectField('benchmark','Average / benchmark',[['off','Off'],['organization','Organization average by week'],['visible','Visible population by week'],['overall','Overall visible average']],prefs.benchmark))}<small data-v-benchmark-note class="asc-hint"></small>${setting(checkField('targetEnabled','Goal line',prefs.targetEnabled))}${setting(inputField('target','Goal value',prefs.target??'','number','step="any"'))}${setting(selectField('endLabelMode','Line labels',LINE_LABEL_MODES,prefs.endLabelMode))}${setting(inputField('endLabelCount','Number at each end (N)',prefs.endLabelCount,'number','min="1" max="8" step="1"'))}<small class="asc-hint">Top/bottom ranks use the average of each visible line’s unsmoothed values in the displayed dates. Blanks are excluded. Other lines stay visible.</small><h3>Displayed window</h3>${setting(selectField('window','Weeks',[['all','All available'],['12','12 weeks'],['8','8 weeks'],['4','4 weeks'],['custom','Custom']],prefs.window))}<div class="asc-two" data-v-custom>${setting(inputField('start','From',prefs.start,'date'))}${setting(inputField('end','Through',prefs.end,'date'))}</div><button type="button" data-v-reset>Reset View</button><details class="asc-capture-options"><summary>Capture / chart defaults</summary>${setting(selectField('captureLayout','Capture layout',[['standard','Standard'],['wide','Wide'],['presentation','Presentation']],prefs.captureLayout))}<div class="asc-inline"><button type="button" data-v-copy>Copy Chart</button><button type="button" data-v-png>Download PNG</button></div><button type="button" data-v-defaults>Save as chart defaults</button><p class="asc-hint">Visualization changes stay in this session unless saved here. Research calculation settings are unchanged.</p></details><button type="button" data-v-quick-copy>Copy Chart</button></section>`:''}</aside></div><p class="asc-hint asc-view-notice" data-v-notice role="status" aria-live="polite"></p>`;
    const find=selector=>host.querySelector(selector),legend=find('[data-v-legend]'),plot=find('[data-v-svg]');let current,legendKey='';
    const message=text=>{find('[data-v-notice]').textContent=text;};
    const change=patch=>{session.preferences=viewerPreferences({...session.preferences,...patch});refreshViewer(session);};
    function emphasize(id){
      const selected=id||session.preferences.selectedSeries;
      plot.querySelectorAll('[data-chart-line]').forEach(node=>{const active=node.dataset.chartParent===selected||node.dataset.chartLine===selected;node.style.opacity=selected&&!active?'.22':'1';});
      plot.querySelectorAll('[data-chart-path]').forEach(node=>node.setAttribute('stroke-width',String(current.def.lineWidth+(node.dataset.chartPath===selected?1.5:0))));
      legend.querySelectorAll('[data-v-row]').forEach(node=>node.classList.toggle('asc-series-focused',node.dataset.vRow===selected));
    }
    function paintDetail(){
      const selected=session.preferences.selectedPoint,series=current.data.series.find(s=>s.id===selected?.seriesId),point=series?.points.find(p=>p.categoryKey===selected?.categoryKey),detail=find('[data-v-detail]');
      detail.hidden=!point;if(point){detail.innerHTML=`<button type="button" data-v-close-point aria-label="Close selected point">×</button><strong>Selected point</strong><p>${escape(pointDescription(series,point,current.def)).replace(/\n/g,'<br>')}</p>`;detail.querySelector('[data-v-close-point]').onclick=()=>change({selectedPoint:null});}
      plot.querySelectorAll('[data-chart-point]').forEach(node=>{const s=current.data.series.find(s=>s.id===node.dataset.chartSeries),p=s?.points[Number(node.dataset.chartPoint)];node.classList.toggle('asc-selected-point',!!selected&&s?.id===selected.seriesId&&p?.categoryKey===selected.categoryKey);});
    }
    function filterLegend(){
      const query=session.preferences.legendQuery.toLocaleLowerCase();legend.querySelectorAll('[data-v-row]').forEach(node=>node.hidden=!!query&&!node.dataset.vName.toLocaleLowerCase().includes(query));
    }
    function paintLegend(){
      const key=JSON.stringify(current.allSeries.map(s=>[s.id,s.displayName||s.name]));
      if(key!==legendKey){legendKey=key;legend.innerHTML=current.allSeries.map(s=>`<div class="asc-series-row" data-v-row="${escape(s.id)}" data-v-name="${escape(s.displayName||s.name)}" style="--series-color:${seriesColor(s,current.data)}"><button type="button" data-v-toggle="${escape(s.id)}" aria-pressed="true"><span class="asc-series-check" aria-hidden="true">✓</span><span>${escape(s.displayName||s.name)}</span></button><button type="button" class="asc-series-focus" data-v-focus="${escape(s.id)}" aria-label="Highlight ${escape(s.displayName||s.name)}">Focus</button><button type="button" class="asc-series-isolate" data-v-isolate="${escape(s.id)}" aria-label="Isolate ${escape(s.displayName||s.name)}">Only</button></div>`).join('');
        legend.querySelectorAll('[data-v-row]').forEach(row=>{row.onmouseenter=()=>emphasize(row.dataset.vRow);row.onmouseleave=()=>emphasize('');});
        legend.querySelectorAll('[data-v-toggle]').forEach(button=>button.onclick=()=>{const id=button.dataset.vToggle,hidden=new Set(session.preferences.hiddenSeries);if(hidden.has(id))hidden.delete(id);else hidden.add(id);change({hiddenSeries:[...hidden],selectedSeries:hidden.has(id)&&session.preferences.selectedSeries===id?'':session.preferences.selectedSeries});});
        legend.querySelectorAll('[data-v-focus]').forEach(button=>button.onclick=()=>change({selectedSeries:session.preferences.selectedSeries===button.dataset.vFocus?'':button.dataset.vFocus}));
        legend.querySelectorAll('[data-v-isolate]').forEach(button=>button.onclick=()=>change({hiddenSeries:current.allSeries.filter(s=>s.id!==button.dataset.vIsolate).map(s=>s.id),selectedSeries:button.dataset.vIsolate}));
      }
      const hidden=new Set(session.preferences.hiddenSeries);legend.querySelectorAll('[data-v-toggle]').forEach(button=>{const off=hidden.has(button.dataset.vToggle);button.setAttribute('aria-pressed',String(!off));button.closest('[data-v-row]').classList.toggle('asc-series-hidden',off);button.querySelector('.asc-series-check').textContent=off?'':'✓';});
      find('[data-v-search]').value=session.preferences.legendQuery;filterLegend();find('[data-v-count]').textContent=`${current.visible.length} of ${current.allSeries.length}`;
      find('.asc-series-tools').classList.toggle('asc-small-legend',current.allSeries.length<=5&&!fullscreen);
    }
    function inspect(series,point){if(!point)return;change({selectedSeries:series.parentId||series.id,selectedPoint:{seriesId:series.id,categoryKey:point.categoryKey}});}
    function bindPlot(){
      plot.querySelectorAll('[data-chart-point]').forEach(node=>{const series=current.data.series.find(s=>s.id===node.dataset.chartSeries),point=series?.points[Number(node.dataset.chartPoint)];if(!point)return;
        const show=()=>{const tip=find('[data-v-tooltip]');tip.textContent=pointDescription(series,point,current.def);tip.hidden=false;emphasize(series.parentId||series.id);};
        const hide=()=>{find('[data-v-tooltip]').hidden=true;emphasize('');};node.onmouseenter=show;node.onmouseleave=hide;node.onfocus=show;node.onblur=hide;node.onclick=()=>inspect(series,point);node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect(series,point);}};
      });
      plot.querySelectorAll('[data-chart-hit]').forEach(node=>{const series=current.data.series.find(s=>s.id===node.dataset.chartHit);const select=()=>{change({selectedSeries:series.parentId||series.id});const row=[...legend.querySelectorAll('[data-v-row]')].find(r=>r.dataset.vRow===(series.parentId||series.id));row?.scrollIntoView?.({block:'nearest'});};node.onmouseenter=()=>emphasize(series.parentId||series.id);node.onmouseleave=()=>emphasize('');node.onclick=select;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
    }
    view.paint=()=>{
      host.classList.toggle('asc-panel-collapsed',fullscreen&&session.preferences.panelCollapsed);
      current=viewerDataset(session);view.current=current;view.lastWidth=plot.clientWidth||1000;const width=Math.max(320,Math.min(1600,view.lastWidth)),height=fullscreen?(width<650?350:520):Math.max(270,Math.min(420,width*.46)),drawing=renderSVG(current.def,current.data,{width,height});plot.innerHTML=drawing.svg;
      find('[data-v-subtitle]').textContent=current.subtitle;find('[data-v-context]').textContent=[current.population,current.timeframe].filter(Boolean).join(' · ');paintLegend();bindPlot();paintDetail();emphasize('');
      if(fullscreen){const p=session.preferences,s=current.summary;find('[data-v-summary]').innerHTML=[['Visible series',`${s.visible} of ${s.total}`],['Periods',s.periods],['Highest latest',format(s.highest,current.def)],['Lowest latest',format(s.lowest,current.def)],['Visible average',format(s.average,current.def)]].map(([label,value])=>`<span><small>${escape(label)}</small><strong>${escape(value)}</strong></span>`).join('');
        host.classList.toggle('asc-panel-collapsed',p.panelCollapsed);find('.asc-view-panel').hidden=p.panelCollapsed;find('[data-v-panel-toggle]').textContent=p.panelCollapsed?'›':'‹';find('[data-v-panel-toggle]').setAttribute('aria-expanded',String(!p.panelCollapsed));find('[data-v-panel-toggle]').setAttribute('aria-label',p.panelCollapsed?'Show series and analysis panel':'Collapse series and analysis panel');find('[data-v-time-tools]').hidden=!current.timeSeries;find('[data-v-setting=rollingDisplay]').disabled=p.rolling<2;find('[data-v-setting=endLabelMode]').disabled=!current.timeSeries;find('[data-v-setting=endLabelCount]').disabled=!current.timeSeries||!['top','bottom','both'].includes(p.endLabelMode);find('[data-v-custom]').hidden=p.window!=='custom';find('[data-v-benchmark-note]').textContent=current.benchmarkNote;host.querySelectorAll('[data-v-setting]').forEach(control=>{const value=p[control.dataset.vSetting];if(control.type==='checkbox')control.checked=!!value;else control.value=value??'';});
      }
      if(drawing.clipped)message('Point markers are sampled for display. Capture retains the full chart.');
      if(!current.data.series.some(s=>s.points.some(p=>p.value!=null))&&session.result.perf?.calculationDiagnostics?.reason)message(session.result.perf.calculationDiagnostics.reason);
    };
    find('[data-v-search]').oninput=event=>{session.preferences.legendQuery=event.target.value;for(const other of session.views)if(other.host.isConnected)other.filterLegend?.();};view.filterLegend=filterLegend;
    find('[data-v-show]').onclick=()=>change({hiddenSeries:[],selectedSeries:''});find('[data-v-hide]').onclick=()=>change({hiddenSeries:current.allSeries.map(s=>s.id),selectedSeries:''});
    if(fullscreen){
      find('[data-v-panel-toggle]').onclick=()=>change({panelCollapsed:!session.preferences.panelCollapsed});
      host.querySelectorAll('[data-v-setting]').forEach(control=>control.onchange=()=>change({[control.dataset.vSetting]:control.type==='checkbox'?control.checked:control.value}));
      find('[data-v-reset]').onclick=()=>change({window:'all',start:'',end:''});
      find('[data-v-defaults]').onclick=()=>{try{saveViewerDefaults(session);message('Chart defaults saved.');}catch(error){message(error.message);}};
      const capture=copyImage=>async()=>{try{const context=viewerDataset(session);message(await copyOrDownloadCapture(captureSurface(context.def,context.data,context,session.preferences.captureLayout),session.item.title,copyImage));}catch(error){message(error.message||String(error));}};
      find('[data-v-copy]').onclick=capture(true);find('[data-v-quick-copy]').onclick=capture(true);find('[data-v-png]').onclick=capture(false);
    }
    view.paint();
    if(root.ResizeObserver){let frame;const observer=new root.ResizeObserver(()=>{if(host.isConnected&&plot.clientWidth>0&&Math.abs(plot.clientWidth-view.lastWidth)>2){if(frame)root.cancelAnimationFrame?.(frame);frame=root.requestAnimationFrame(()=>{if(host.isConnected)view.paint();});}});observer.observe(plot);view.dispose=()=>{observer.disconnect();if(frame)root.cancelAnimationFrame?.(frame);};}
    return view;
  }
  let activeExplorer=null;
  async function openViewer(researchId){
    if(activeExplorer?.key===researchId&&activeExplorer.view.overlay.isConnected){activeExplorer.view.overlay.querySelector('[data-asc-close]').focus();return activeExplorer.view;}
    const ref=await resolve(researchId);if(activeExplorer)activeExplorer.view.close();const session=viewerSession(ref.item,ref.result),canvas=root.document.getElementById('researchCanvas'),scroll={top:canvas?.scrollTop,left:canvas?.scrollLeft};
    const view=dialog(ref.item.title||'Research chart','asc-explorer');view.overlay.querySelector('[data-asc-close]').textContent='×';view.overlay.querySelector('[data-asc-close]').setAttribute('aria-label','Close fullscreen chart');mountViewer(view.body,session,true);activeExplorer={key:researchId,view};
    view.onClose(()=>{view.body._ascViewer?.dispose?.();session.views.delete(view.body._ascViewer);activeExplorer=null;if(canvas){canvas.scrollTop=scroll.top;canvas.scrollLeft=scroll.left;}});return view;
  }
  async function captureViewer(researchId,copyImage=false){const ref=await resolve(researchId),session=viewerSession(ref.item,ref.result),context=viewerDataset(session);return copyOrDownloadCapture(captureSurface(context.def,context.data,context,session.preferences.captureLayout),session.item.title,copyImage);}
  function bindViewers(scope){scope.querySelectorAll('[data-asc-viewer]').forEach(host=>{const ref=references.get(host.dataset.ascViewer);if(ref)mountViewer(host,viewerSession(ref.item,ref.result));else resolve(host.dataset.ascViewer).then(ref=>{if(host.isConnected)mountViewer(host,viewerSession(ref.item,ref.result));}).catch(error=>{host.textContent=error.message;});});}
  function storage(){return adapters.storage||root.localStorage;}
  function readStore(key,field){
    const raw=storage()?.getItem(key);if(!raw)return {schemaVersion:VERSION,[field]:[]};
    let parsed;try{parsed=JSON.parse(raw);}catch(e){throw new Error('Saved chart storage cannot be read. Existing data was left intact. Export or recover browser storage before saving.');}
    if(parsed.schemaVersion!==VERSION||!Array.isArray(parsed[field]))throw new Error('This chart storage version is not supported. Existing saved data was left intact.');
    return parsed;
  }
  function writeStore(key,value){const store=storage();if(!store?.setItem)throw new Error('Browser storage is unavailable. Export this chart configuration to keep your work.');try{store.setItem(key,JSON.stringify(value));}catch(error){throw new Error('Chart could not be saved. Browser storage may be full or blocked. Your chart remains open; export its configuration or retry.');}}
  function savedCharts(){return readStore(CHARTS_KEY,'charts').charts;}
  function saveDefinition(def){
    const saved=normalize(def),record=readStore(CHARTS_KEY,'charts');saved.id=saved.id||makeId('chart');saved.savedAt=new Date().toISOString();
    const index=record.charts.findIndex(chart=>chart.id===saved.id);if(index<0)record.charts.push(saved);else record.charts[index]=saved;
    writeStore(CHARTS_KEY,record);adapters.onSaved?.(saved);root.AllStarWorkspaceNavigation?.record?.({id:'chart:'+saved.id,label:saved.title||saved.name,category:'Charts'});root.AllStarWorkspaceNavigation?.refresh?.();return saved;
  }
  function boardCards(){return readStore(BOARD_KEY,'cards').cards;}
  function pinCard(card){
    if(!['chart','table','kpi'].includes(card.type))throw new Error('Choose a chart, table, or KPI card.');
    if(card.type==='chart'&&!card.chartId)throw new Error('Save the chart before pinning it.');
    if(card.type!=='chart'&&!card.researchId)throw new Error('Save the Research item before pinning a result.');
    const record=readStore(BOARD_KEY,'cards'),saved={id:makeId('card'),type:card.type,chartId:String(card.chartId||''),researchId:String(card.researchId||''),title:String(card.title||''),columnIndex:Math.max(0,Number(card.columnIndex)||0),rowIndex:Math.max(0,Number(card.rowIndex)||0),rowKey:String(card.rowKey||''),columnKey:String(card.columnKey||'')};
    record.cards.push(saved);writeStore(BOARD_KEY,record);return saved;
  }
  function moveCard(id,direction){const record=readStore(BOARD_KEY,'cards'),from=record.cards.findIndex(card=>card.id===id),to=Math.max(0,Math.min(record.cards.length-1,from+Math.sign(direction)));if(from<0||from===to)return record.cards;const [card]=record.cards.splice(from,1);record.cards.splice(to,0,card);writeStore(BOARD_KEY,record);return record.cards;}
  function removeCard(id){const record=readStore(BOARD_KEY,'cards');record.cards=record.cards.filter(card=>card.id!==id);writeStore(BOARD_KEY,record);}
  function register(item,result){const key=String(item.id||makeId('result'));references.delete(key);references.set(key,{item,result});while(references.size>24)references.delete(references.keys().next().value);return key;}
  async function resolve(researchId){const current=references.get(researchId);if(current)return current;const resolved=await adapters.resolveResult?.(researchId);if(resolved?.result){register(resolved.item||{id:researchId},resolved.result);return resolved;}const ref=references.get(researchId);if(ref)return ref;throw new Error('Open this Research item and refresh its result first. Chart editing does not run Research automatically.');}
  function download(name,content,type='text/plain;charset=utf-8'){
    if(adapters.download)return adapters.download(name,content,type);
    const blob=content instanceof root.Blob?content:new root.Blob([content],{type}),url=root.URL.createObjectURL(blob),a=root.document.createElement('a');a.href=url;a.download=name;root.document.body.appendChild(a);a.click();a.remove();setTimeout(()=>root.URL.revokeObjectURL(url),1000);
  }
  function safeFilename(title){return String(title||'research-chart').replace(/[^\w\- .]/g,'').trim().replace(/\s+/g,'-').slice(0,100)||'research-chart';}
  function csvCell(value){let text=String(value??'');if(/^[=+@\t\r]/.test(text)||/^-(?!\d)/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
  function dataRows(data){const rows=[['Series','Group / X','Value','Derived','Supporting result rows']];for(const s of data.series)for(const p of s.points)rows.push([s.name,p.label,p.value,s.derived?'Yes':'No',p.refs.map(r=>r.rowIndex+1).join('; ')]);return rows;}
  function toCSV(data){return dataRows(data).map(row=>row.map(csvCell).join(',')).join('\r\n');}
  function resultActions(item,result){
    if(!array(result?.data).length||!columnsFor(result).length)return '';
    const key=register(item,result);return `<div class="asc-result-actions"><button type="button" class="smallBtn" data-asc-open="${escape(key)}">Create Chart</button><button type="button" class="smallBtn" data-asc-compare="${escape(key)}">Compare Groups</button><button type="button" class="smallBtn" data-asc-pin="${escape(key)}" data-asc-kind="table">Pin Table</button><button type="button" class="smallBtn" data-asc-pin="${escape(key)}" data-asc-kind="kpi">Pin KPI</button><span class="hint">Suggested: ${escape(recommend(item,result).replace(/-/g,' '))}</span></div>`;
  }
  function bind(scope){
    if(!scope?.querySelectorAll)return;
    bindViewers(scope);
    scope.querySelectorAll('[data-asc-open]').forEach(button=>button.onclick=()=>openForResearch(button.dataset.ascOpen).catch(reportError));
    scope.querySelectorAll('[data-asc-compare]').forEach(button=>button.onclick=async()=>{try{const ref=await resolve(button.dataset.ascCompare);openComparison(ref.item,ref.result);}catch(error){reportError(error);}});
    scope.querySelectorAll('[data-asc-pin]').forEach(button=>button.onclick=async()=>{try{const ref=await resolve(button.dataset.ascPin);if(button.dataset.ascKind==='kpi'){openKpiPicker(ref.item,ref.result);return;}pinCard({type:'table',researchId:ref.item.id,title:ref.item.title});button.textContent='Pinned to Board';}catch(error){reportError(error);}});
  }
  function reportError(error){if(adapters.onError)adapters.onError(error);else root.alert?.(error.message||String(error));}
  function dialog(title,className=''){
    const doc=root.document,prior=doc.activeElement,overlay=doc.createElement('div');overlay.className='asc-overlay '+className;overlay.innerHTML=`<section class="asc-dialog" role="dialog" aria-modal="true" aria-label="${escape(title)}"><header class="asc-dialog-head"><h2>${escape(title)}</h2><button type="button" data-asc-close aria-label="Close ${escape(title)}">Close</button></header><div class="asc-dialog-content"></div><div class="asc-message" role="status" aria-live="polite"></div></section>`;doc.body.appendChild(overlay);
    let onClose=()=>{};const close=()=>{overlay.remove();if(prior?.isConnected)prior.focus({preventScroll:true});onClose();};overlay.querySelector('[data-asc-close]').onclick=close;
    overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}if(event.key==='Tab'){const focusable=[...overlay.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&!el.closest('[hidden]'));const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus();}}};
    overlay.querySelector('[data-asc-close]').focus();return {overlay,body:overlay.querySelector('.asc-dialog-content'),message:text=>{overlay.querySelector('.asc-message').textContent=String(text);},close,onClose:callback=>{onClose=callback;}};
  }
  function option(value,label,selected){return `<option value="${escape(value)}"${String(value)===String(selected)?' selected':''}>${escape(label)}</option>`;}
  function field(label,control){return `<label class="asc-field"><span>${escape(label)}</span>${control}</label>`;}
  function inputField(key,label,value,type='text',extra=''){return field(label,`<input data-setting="${key}" type="${type}" value="${escape(value??'')}" ${extra}>`);}
  function checkField(key,label,value){return `<label class="asc-check"><input data-setting="${key}" type="checkbox"${value?' checked':''}> ${escape(label)}</label>`;}
  function selectField(key,label,options,value){return field(label,`<select data-setting="${key}">${options.map(([v,l])=>option(v,l,value)).join('')}</select>`);}
  function controls(def,result){
    const cols=columnsFor(result),axes=[['label','Result group'],['date','Result date (timestamp)'],['xValue','Research X value'],...cols.map(c=>['value:'+c.index,c.label])];
    return `<details open><summary>Data</summary>${selectField('type','Chart type',TYPES.map(t=>[t,t.replace(/-/g,' ')]),def.type)}${selectField('x','X axis',axes,def.x)}<fieldset><legend>Y measures</legend>${cols.map(c=>`<label class="asc-check"><input type="checkbox" data-y="${c.index}"${def.y.includes(c.index)?' checked':''}> ${escape(c.label)}</label>`).join('')}</fieldset>${checkField('secondary','Compare secondary groups',def.secondary)}${checkField('panel','Separate result panels',def.panel)}${selectField('aggregation','Aggregate displayed result values',[['none','Keep result values'],['sum','Sum'],['avg','Average of groups'],['min','Minimum'],['max','Maximum'],['count','Count result groups']],def.aggregation)}${selectField('sort','Order',[['source','Research result order'],['dateAsc','Date oldest first'],['labelAsc','Label A to Z'],['labelDesc','Label Z to A'],['valueDesc','Highest value first'],['valueAsc','Lowest value first']],def.sort)}${inputField('topN','Maximum groups (0 = all)',def.topN,'number','min="0" step="1"')}<div class="asc-inline"><button type="button" data-top="high">Top 5</button><button type="button" data-top="low">Bottom 5</button><button type="button" data-top="all">All</button></div>${inputField('include','Include exact groups (comma separated)',def.include)}${inputField('exclude','Exclude exact groups (comma separated)',def.exclude)}<div class="asc-two">${inputField('start','From date',def.start,'date')}${inputField('end','Through date',def.end,'date')}</div><button type="button" data-reset-range>Reset date range</button>${selectField('bubble','Bubble size',[[-1,'Supporting source row count'],...cols.map(c=>[c.index,c.label])],def.bubble)}${inputField('bins','Histogram buckets',def.bins,'number','min="2" max="100"')}</details>
      <details><summary>Appearance</summary>${inputField('title','Title',def.title)}${inputField('subtitle','Subtitle',def.subtitle)}${inputField('xLabel','X axis label',def.xLabel)}${inputField('yLabel','Y axis label',def.yLabel)}${selectField('format','Number format',[['number','Number'],['percent','Percent: 52 → 52%'],['decimal_percent','Decimal percent: 0.52 → 52%'],['currency','Currency ($)']],def.format)}${inputField('decimals','Decimal places',def.decimals,'number','min="0" max="6"')}${inputField('lineWidth','Line thickness',def.lineWidth,'range','min="1" max="8"')}${checkField('legend','Legend',def.legend)}${checkField('dataLabels','Data labels (up to 60 points)',def.dataLabels)}${checkField('grid','Gridlines',def.grid)}${checkField('points','Point markers',def.points)}${checkField('fill','Area fill',def.fill)}${selectField('endLabelMode','Line labels',LINE_LABEL_MODES,def.endLabelMode)}${inputField('endLabelCount','Number at each end (N)',def.endLabelCount,'number','min="1" max="8" step="1"')}<p class="asc-hint">Rank labels by each visible line’s average before smoothing, within this view. Missing values are excluded; other lines stay visible.</p></details>
      <details><summary>Analysis</summary><p class="asc-hint">Uses the calculated result in displayed order. A point represents one result period/group; rates remain in their original scale.</p>${checkField('average','Average reference lines',def.average)}${checkField('trend','Linear trend lines',def.trend)}${inputField('target','Target (original value scale)',def.target,'number','step="any"')}${inputField('rolling','Rolling average window in points (0 = off)',def.rolling,'number','min="0" max="1000"')}${selectField('rollingDisplay','Line display',[['overlay','Original + rolling average'],['only','Rolling average only']],def.rollingDisplay)}${checkField('cumulative','Cumulative values',def.cumulative)}${checkField('previous','Previous-period overlay',def.previous)}${inputField('periodLag','Previous period distance (points)',def.periodLag,'number','min="1" max="1000"')}${selectField('change','Period change',[['none','Original values'],['difference','Difference from previous period'],['percent','Percent change from previous period']],def.change)}</details>`;
  }
  function tableHTML(result,limit=150){const cols=columnsFor(result);return `<div class="asc-table-wrap"><table><thead><tr><th>Group</th><th>Series</th>${cols.map(c=>`<th>${escape(c.label)}</th>`).join('')}</tr></thead><tbody>${array(result.data).slice(0,limit).map(row=>`<tr><td>${escape(row.label)}</td><td>${escape([row.secondary,row.panel].filter(Boolean).join(' · '))}</td>${cols.map(c=>`<td>${escape(row.values?.[c.index]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="asc-hint">Showing ${Math.min(limit,array(result.data).length).toLocaleString()} of ${array(result.data).length.toLocaleString()} calculated result rows. CSV exports all chart points.</p>`;}
  function showPoint(item,result,point,columnIndex){
    const view=dialog('Supporting result rows','asc-detail'),refs=point.refs||[],rows=refs.map(ref=>result.data?.[ref.rowIndex]).filter(Boolean);view.body.innerHTML=`<p>${escape(point.label)} · ${rows.length.toLocaleString()} calculated result row${rows.length===1?'':'s'}</p>${tableHTML({...result,data:rows},150)}<p class="asc-hint">These are calculated Research groups. Use Explain in Research to trace a group to source rows and calculation rules.</p>${adapters.onDrill&&refs.length===1?'<button type="button" data-explain>Explain this result</button>':''}`;
    const explain=view.body.querySelector('[data-explain]');if(explain)explain.onclick=()=>adapters.onDrill(item,rows[0],refs[0].columnIndex??columnIndex,result);
  }
  function draftFor(itemId){if(draftMemory.has(itemId))return draftMemory.get(itemId);try{return readStore(DRAFT_KEY,'drafts').drafts.find(d=>d.researchId===itemId)?.definition||null;}catch(e){return null;}}
  function writeDraft(itemId,definition){if(definition)draftMemory.set(itemId,clone(definition));else draftMemory.delete(itemId);while(draftMemory.size>12)draftMemory.delete(draftMemory.keys().next().value);const store=readStore(DRAFT_KEY,'drafts');store.drafts=store.drafts.filter(d=>d.researchId!==itemId);if(definition)store.drafts.push({researchId:itemId,definition});store.drafts=store.drafts.slice(-12);writeStore(DRAFT_KEY,store);}
  function open(item,result,definition){
    if(!result?.data?.length)throw new Error('This result has no grouped values to chart. Run a grouped Research table or chart first.');
    register(item,result);let def=normalize(definition||{},item,result),savedJSON=JSON.stringify(def),history=[clone(def)],position=0,data,rendered;
    const view=dialog('Chart Designer'),draft=draftFor(item.id);
    view.body.innerHTML=`<div class="asc-toolbar"><span data-save-state>Unsaved chart</span><button type="button" data-undo disabled>Undo</button><button type="button" data-redo disabled>Redo</button><button type="button" data-save>Save Chart</button><button type="button" data-pin>Pin to Board</button><button type="button" data-board>Analysis Board</button><details class="asc-export-menu"><summary>Export</summary><button type="button" data-export="csv">CSV</button><button type="button" data-export="xlsx">Excel</button><button type="button" data-export="svg">Chart image (SVG)</button><button type="button" data-export="png">Chart image (PNG)</button><button type="button" data-export="copy">Copy table</button><button type="button" data-export="copy-chart">Copy chart</button><button type="button" data-export="json">Chart configuration JSON</button></details>${draft?'<button type="button" data-restore>Restore unsaved draft</button>':''}</div><div class="asc-designer"><aside class="asc-controls" aria-label="Chart settings"></aside><main class="asc-stage"><h3 data-title></h3><p data-subtitle></p><div data-notes class="asc-hint"></div><div data-svg></div><div class="asc-legend" data-legend aria-label="Chart series"></div><p class="asc-hint">Hover or focus a point for exact values; select it for supporting results. Legend buttons show/hide series; Isolate focuses one series.</p><details><summary>Underlying Research result</summary><div data-table></div></details></main></div>`;
    const settings=view.body.querySelector('.asc-controls');view.body.querySelector('[data-table]').innerHTML=tableHTML(result);
    const status=()=>{const dirty=!def.id||JSON.stringify(def)!==savedJSON;view.body.querySelector('[data-save-state]').textContent=dirty?'Unsaved changes':'Saved';view.body.querySelector('[data-undo]').disabled=position===0;view.body.querySelector('[data-redo]').disabled=position===history.length-1;};
    function paint(){
      data=buildDataset(def,result);rendered=renderSVG(def,data);view.body.querySelector('[data-title]').textContent=def.title;view.body.querySelector('[data-subtitle]').textContent=def.subtitle;
      view.body.querySelector('[data-notes]').textContent=[...data.warnings,...data.statistics.slice(0,8).map(s=>s.name+': Pearson r '+(s.r==null?'undefined':s.r.toFixed(3))+' · '+s.n+' valid result pairs.'),data.numeric?'Correlation is descriptive and does not establish causation.':'',rendered.clipped?'Chart is sampled to at most 1,000 marks per series and about 2,500 visible marks in total; CSV retains all values.':'',rendered.seriesClipped?'First 32 visible series shown. Hide or isolate series to inspect others.':'',def.resultRenderedAt?'Calculated result: '+def.resultRenderedAt:'Uses the current calculated Research result.'].filter(Boolean).join(' ');
      view.body.querySelector('[data-svg]').innerHTML=rendered.svg;
      const legend=view.body.querySelector('[data-legend]');legend.hidden=!def.legend;legend.innerHTML=rendered.legend.map(l=>`<span class="asc-legend-item"><button type="button" data-series="${escape(l.id)}" aria-pressed="${!l.hidden}" style="--series-color:${l.color}">${escape(l.name)}</button><button type="button" class="asc-isolate" data-isolate="${escape(l.id)}" aria-label="Isolate ${escape(l.name)}">Isolate</button></span>`).join('')+`<button type="button" data-restore-series>Show all</button>`;
      legend.querySelectorAll('[data-series]').forEach(button=>button.onclick=()=>{const hidden=new Set(def.hiddenSeries);if(hidden.has(button.dataset.series))hidden.delete(button.dataset.series);else hidden.add(button.dataset.series);change({...def,hiddenSeries:[...hidden]},false);});
      legend.querySelectorAll('[data-isolate]').forEach(button=>button.onclick=()=>{const others=data.series.filter(s=>s.id!==button.dataset.isolate).map(s=>s.id),isolated=others.length===def.hiddenSeries.length&&others.every(id=>def.hiddenSeries.includes(id));change({...def,hiddenSeries:isolated?[]:others},false);});
      legend.querySelector('[data-restore-series]').onclick=()=>change({...def,hiddenSeries:[]},false);
      view.body.querySelectorAll('[data-chart-point]').forEach(node=>{const inspect=()=>{const s=data.series.find(s=>s.id===node.dataset.chartSeries),p=s?.points[Number(node.dataset.chartPoint)];if(p?.refs?.length)showPoint(item,result,p,s.columnIndex);};node.onclick=inspect;node.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect();}};});status();
    }
    function change(next,rebuildControls=true){def=normalize(next,item,result);history.splice(position+1);history.push(clone(def));if(history.length>40)history.shift();position=history.length-1;if(rebuildControls)bindControls();paint();}
    function bindControls(){
      settings.innerHTML=controls(def,result);
      settings.querySelectorAll('[data-setting]').forEach(control=>control.onchange=()=>{const key=control.dataset.setting,value=control.type==='checkbox'?control.checked:control.value;change({...def,[key]:value},false);});
      settings.querySelectorAll('[data-y]').forEach(control=>control.onchange=()=>{const selected=[...settings.querySelectorAll('[data-y]:checked')].map(c=>Number(c.dataset.y));if(!selected.length){control.checked=true;view.message('Choose at least one Y measure.');return;}change({...def,y:selected},false);});
      settings.querySelectorAll('[data-top]').forEach(button=>button.onclick=()=>change({...def,topN:button.dataset.top==='all'?0:5,sort:button.dataset.top==='all'?'source':button.dataset.top==='high'?'valueDesc':'valueAsc'}));
      settings.querySelector('[data-reset-range]').onclick=()=>change({...def,start:'',end:''});
    }
    function save(){def.name=def.title||def.name;def=saveDefinition(def);savedJSON=JSON.stringify(def);try{writeDraft(item.id,null);}catch(error){/* Chart itself is already saved. */}status();view.message('Chart saved. Its Research configuration and data are unchanged.');return def;}
    view.body.querySelector('[data-save]').onclick=()=>{try{save();}catch(error){view.message(error.message);}};
    view.body.querySelector('[data-pin]').onclick=()=>{try{save();pinCard({type:'chart',chartId:def.id,researchId:item.id,title:def.title});view.message('Chart saved and pinned to the Analysis Board.');}catch(error){view.message(error.message);}};
    view.body.querySelector('[data-board]').onclick=()=>openBoard();
    for(const [selector,delta] of [['[data-undo]',-1],['[data-redo]',1]])view.body.querySelector(selector).onclick=()=>{position+=delta;def=clone(history[position]);bindControls();paint();};
    const restore=view.body.querySelector('[data-restore]');if(restore)restore.onclick=()=>{change(draft);restore.remove();view.message('Unsaved draft restored.');};
    view.body.querySelectorAll('[data-export]').forEach(button=>button.onclick=async()=>{try{const kind=button.dataset.export,name=safeFilename(def.title);if(kind==='csv')download(name+'.csv',toCSV(data),'text/csv;charset=utf-8');else if(kind==='json')download(name+'.json',JSON.stringify({schemaVersion:VERSION,definition:def},null,2),'application/json');else if(kind==='svg')download(name+'.svg',captureSurface(def,data,{subtitle:def.subtitle}).svg,'image/svg+xml');else if(kind==='xlsx'){if(!root.XLSX?.utils)throw new Error('Excel export is unavailable in this build. Export CSV instead.');const workbook=root.XLSX.utils.book_new();root.XLSX.utils.book_append_sheet(workbook,root.XLSX.utils.aoa_to_sheet(dataRows(data)),'Chart Data');root.XLSX.writeFile(workbook,name+'.xlsx');}else if(kind==='copy'){if(!root.navigator?.clipboard?.writeText)throw new Error('Clipboard access is unavailable here. Export CSV instead.');await root.navigator.clipboard.writeText(dataRows(data).map(row=>row.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n'));view.message('Chart data copied.');}else view.message(await copyOrDownloadCapture(captureSurface(def,data,{subtitle:def.subtitle}),def.title,kind==='copy-chart'));}catch(error){view.message(error.message||String(error));}});
    view.onClose(()=>{if(JSON.stringify(def)!==savedJSON||!def.id)try{writeDraft(item.id,def);}catch(error){reportError(new Error('Your unsaved chart draft is kept for this session, but browser storage could not save it. Reopen Chart Designer and export its configuration to keep it after closing this browser.'));}});
    bindControls();paint();return view;
  }
  function imageBlob(svg){return new Promise((resolve,reject)=>{
    if(adapters.imageBlob){Promise.resolve(adapters.imageBlob(svg)).then(resolve,reject);return;}
    const dimensions=svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/),width=Number(dimensions?.[1])||1000,height=Number(dimensions?.[2])||460,scale=Math.min(2,16384/Math.max(width,height));
    const url=root.URL.createObjectURL(new root.Blob([svg],{type:'image/svg+xml'})),image=new root.Image();
    image.onload=()=>{try{const canvas=root.document.createElement('canvas');canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);const context=canvas.getContext('2d');if(!context)throw new Error('Canvas is unavailable.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image export failed. Try SVG.')),'image/png');}catch(error){reject(error);}finally{root.URL.revokeObjectURL(url);}};
    image.onerror=()=>{root.URL.revokeObjectURL(url);reject(new Error('Image export failed. Try SVG.'));};image.src=url;
  });}
  async function openForResearch(researchId){const ref=await resolve(researchId);return open(ref.item,ref.result);}
  async function openSaved(id){const def=savedCharts().find(chart=>chart.id===id);if(!def)throw new Error('This saved chart could not be found.');const ref=await resolve(def.researchId);const view=open(ref.item,ref.result,def);root.AllStarWorkspaceNavigation?.record?.({id:'chart:'+def.id,label:def.title||def.name,category:'Charts'});return view;}
  function openKpiPicker(item,result){
    const view=dialog('Pin a KPI','asc-detail'),cols=columnsFor(result);view.body.innerHTML=`<p>Choose the exact result value to pin. The board will use the latest calculated result for this Research item.</p>${selectField('row','Result group',array(result.data).map((r,i)=>[i,[r.label,r.secondary,r.panel].filter(Boolean).join(' · ')]),0)}${selectField('column','Measure',cols.map(c=>[c.index,c.label]),0)}<button type="button" data-pin-kpi>Pin KPI</button>`;
    view.body.querySelector('[data-pin-kpi]').onclick=()=>{try{const rowIndex=Number(view.body.querySelector('[data-setting="row"]').value),columnIndex=Number(view.body.querySelector('[data-setting="column"]').value);pinCard({type:'kpi',researchId:item.id,rowIndex,columnIndex,title:item.title,rowKey:resultRowKey(result.data[rowIndex]),columnKey:resultColumnKey(result,columnIndex)});view.close();}catch(error){view.message(error.message);}};
  }
  function resultRowKey(row){return JSON.stringify([row?.label??'',row?.secondary??'',row?.panel??'']);}
  function resultColumnKey(result,index){const col=result.columns?.[index]||{};return JSON.stringify([col.field||'',col.mode||'',col.displayTitle||col.label||'Measure '+(index+1)]);}
  function resolveKPI(card,result){
    if(!card.rowKey||!card.columnKey)return null;
    const rows=array(result.data).filter(row=>resultRowKey(row)===card.rowKey),columns=columnsFor(result).filter(col=>resultColumnKey(result,col.index)===card.columnKey);
    if(rows.length!==1||columns.length!==1)return null;
    return {row:rows[0],column:columns[0],value:finite(rows[0].values?.[columns[0].index])};
  }
  function groupStats(result,indices,columnIndex){
    const selected=[...new Set(indices)].map(i=>result.data?.[i]).filter(Boolean),values=selected.map(row=>finite(row.values?.[columnIndex])).filter(Number.isFinite).sort((a,b)=>a-b),n=values.length;
    if(!n)return {selected:selected.length,n:0,missing:selected.length,mean:null,median:null,min:null,max:null,stdev:null,q1:null,q3:null};
    const mean=values.reduce((sum,v)=>sum+v,0)/n,quantile=p=>{const at=(n-1)*p,lo=Math.floor(at),hi=Math.ceil(at);return values[lo]+(values[hi]-values[lo])*(at-lo);};
    return {selected:selected.length,n,missing:selected.length-n,mean,median:quantile(.5),min:values[0],max:values[n-1],stdev:n>1?Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(n-1)):null,q1:quantile(.25),q3:quantile(.75)};
  }
  function compareGroups(result,a,b,columnIndex=0){const groupA=groupStats(result,a,columnIndex),groupB=groupStats(result,b,columnIndex),bSet=new Set(b),difference=groupA.mean==null||groupB.mean==null?null:groupB.mean-groupA.mean;return {a:groupA,b:groupB,difference,percentDifference:difference==null||groupA.mean===0?null:difference/Math.abs(groupA.mean)*100,overlap:[...new Set(a)].filter(index=>bSet.has(index)).length};}
  function openComparison(item,result){
    const view=dialog('Compare Result Groups'),selected={a:new Set(),b:new Set()},columns=columnsFor(result);let columnIndex=0;
    view.body.innerHTML=`<p class="asc-hint">Compare groups using values already calculated by Research. Sample size counts numeric result rows; averages are unweighted means of these group values. These statistics do not describe individual source calls or representatives unless each result row represents one.</p>${selectField('measure','Measure',columns.map(c=>[c.index,c.label]),0)}<div class="asc-cohorts">${['a','b'].map(key=>`<section><h3>Group ${key.toUpperCase()}</h3><input type="search" data-cohort-search="${key}" aria-label="Find result rows for Group ${key.toUpperCase()}" placeholder="Find group, team, or representative"><div class="asc-inline"><button type="button" data-cohort-top="${key}">Top 5</button><button type="button" data-cohort-bottom="${key}">Bottom 5</button><button type="button" data-cohort-clear="${key}">Clear</button></div><div data-cohort-list="${key}" class="asc-cohort-list"></div><p data-cohort-count="${key}" class="asc-hint"></p></section>`).join('')}</div><div data-comparison></div><button type="button" data-distribution>View distributions</button>`;
    const label=row=>[row.label,row.secondary,row.panel].filter(Boolean).join(' · ');
    function paint(){
      for(const key of ['a','b']){
        const search=view.body.querySelector('[data-cohort-search="'+key+'"]').value.toLocaleLowerCase(),host=view.body.querySelector('[data-cohort-list="'+key+'"]'),matches=result.data.map((row,index)=>({row,index})).filter(({row})=>label(row).toLocaleLowerCase().includes(search));
        host.innerHTML=matches.slice(0,100).map(({row,index})=>`<label class="asc-check"><input type="checkbox" data-cohort="${key}" data-row="${index}"${selected[key].has(index)?' checked':''}> ${escape(label(row))}: ${escape(format(finite(row.values?.[columnIndex]),{decimals:2}))}</label>`).join('');
        view.body.querySelector('[data-cohort-count="'+key+'"]').textContent=selected[key].size+' selected · '+Math.min(100,matches.length)+' of '+matches.length+' matches shown. Search to find other rows.';
        host.querySelectorAll('[data-row]').forEach(input=>input.onchange=()=>{const index=Number(input.dataset.row);if(input.checked)selected[key].add(index);else selected[key].delete(index);paint();});
      }
      const comparison=compareGroups(result,[...selected.a],[...selected.b],columnIndex),fields=[['Selected rows','selected'],['Numeric sample size','n'],['Missing values','missing'],['Mean','mean'],['Median','median'],['Minimum','min'],['25th percentile','q1'],['75th percentile','q3'],['Maximum','max'],['Sample standard deviation','stdev']];
      view.body.querySelector('[data-comparison]').innerHTML=`<div class="asc-table-wrap"><table><thead><tr><th>Statistic</th><th>Group A</th><th>Group B</th></tr></thead><tbody>${fields.map(([name,key])=>`<tr><th>${name}</th><td>${escape(format(comparison.a[key],{decimals:['selected','n','missing'].includes(key)?0:2}))}</td><td>${escape(format(comparison.b[key],{decimals:['selected','n','missing'].includes(key)?0:2}))}</td></tr>`).join('')}</tbody></table></div><p><strong>Mean difference (B − A):</strong> ${escape(format(comparison.difference,{decimals:2}))} · <strong>Percent difference:</strong> ${escape(format(comparison.percentDifference,{decimals:2,format:'percent'}))}</p>${comparison.overlap?`<p class="asc-message">${comparison.overlap} result row(s) appear in both groups; these are overlapping samples.</p>`:''}<p class="asc-hint">Differences are descriptive, not causal. Percent difference is undefined when Group A's mean is zero. Percentage-point differences use each measure's existing scale.</p>`;
      view.body.querySelector('[data-distribution]').disabled=!comparison.a.n&&!comparison.b.n;
    }
    view.body.querySelector('[data-setting="measure"]').onchange=event=>{columnIndex=Number(event.target.value);paint();};
    view.body.querySelectorAll('[data-cohort-search]').forEach(input=>input.oninput=paint);
    for(const [attr,sign] of [['data-cohort-top',-1],['data-cohort-bottom',1]])view.body.querySelectorAll('['+attr+']').forEach(button=>button.onclick=()=>{const key=button.getAttribute(attr),ranked=result.data.map((row,index)=>({value:finite(row.values?.[columnIndex]),index})).filter(row=>row.value!=null).sort((a,b)=>(a.value-b.value)*sign);selected[key]=new Set(ranked.slice(0,5).map(row=>row.index));paint();});
    view.body.querySelectorAll('[data-cohort-clear]').forEach(button=>button.onclick=()=>{selected[button.dataset.cohortClear].clear();paint();});
    view.body.querySelector('[data-distribution]').onclick=()=>{const distribution={columns:[{label:columns[columnIndex]?.label||'Value'}],data:['a','b'].flatMap(key=>[...selected[key]].map(index=>({label:label(result.data[index]),secondary:'Group '+key.toUpperCase(),values:[finite(result.data[index].values?.[columnIndex])]})))};const chart=dialog('Group Distributions','asc-detail'),def=normalize({type:'histogram',y:[0],title:'Group distributions',decimals:0},item,distribution),drawing=renderSVG(def,buildDataset(def,distribution));chart.body.innerHTML=drawing.svg+'<p class="asc-hint">'+drawing.legend.map(l=>`<span style="color:${l.color}">${escape(l.name)}</span>`).join(' · ')+'</p><p class="asc-hint">Histogram samples are numeric calculated result values; each group uses the same bucket boundaries.</p>';};
    paint();return view;
  }
  function openBoard(){
    const view=dialog('Analysis Board');view.body.innerHTML='<p class="asc-hint">Pin Research tables, exact KPI values, and saved charts. Cards reopen calculated results; refresh Research when you want new values.</p><div class="asc-board-toolbar"><label class="asc-field"><span>Find a saved chart</span><input type="search" data-chart-search placeholder="Search saved chart titles"></label><button type="button" data-import-chart>Import chart JSON</button><input type="file" accept=".json,application/json" data-import-file hidden></div><div data-saved-charts class="asc-saved-charts"></div><div data-board-cards class="asc-board-cards"></div>';
    let generation=0;
    function savedList(){let charts;try{charts=savedCharts();}catch(error){view.message(error.message);return;}const search=view.body.querySelector('[data-chart-search]').value.toLocaleLowerCase(),host=view.body.querySelector('[data-saved-charts]');host.innerHTML=charts.filter(c=>(c.title+' '+c.name).toLocaleLowerCase().includes(search)).map(c=>`<button type="button" data-open-saved="${escape(c.id)}">${escape(c.title||c.name)}</button>`).join('')||'<p class="asc-hint">No matching saved charts. Choose Create Chart on a Research result, then Save Chart.</p>';host.querySelectorAll('[data-open-saved]').forEach(button=>button.onclick=()=>openSaved(button.dataset.openSaved).catch(error=>view.message(error.message)));}
    async function paint(){const request=++generation;let cards;try{cards=boardCards();}catch(error){view.message(error.message);return;}const host=view.body.querySelector('[data-board-cards]');host.innerHTML=cards.map((card,i)=>`<article class="asc-board-card" data-card="${escape(card.id)}"><header><h3>${escape(card.title||card.type)}</h3><div><button type="button" data-card-up="${escape(card.id)}"${i===0?' disabled':''} aria-label="Move ${escape(card.title||card.type)} earlier">↑</button><button type="button" data-card-down="${escape(card.id)}"${i===cards.length-1?' disabled':''} aria-label="Move ${escape(card.title||card.type)} later">↓</button><button type="button" data-card-remove="${escape(card.id)}" aria-label="Unpin ${escape(card.title||card.type)}">Unpin</button></div></header><div data-card-content>Loading calculated result…</div></article>`).join('')||'<div class="asc-empty"><h3>Create your analysis board</h3><p>Start with a Research result, create a trend or comparison chart, and pin it here. Tables and selected KPI values can be pinned directly from Research.</p></div>';
      for(const [attr,direction] of [['data-card-up',-1],['data-card-down',1]])host.querySelectorAll('['+attr+']').forEach(button=>button.onclick=()=>{try{moveCard(button.getAttribute(attr),direction);paint();}catch(error){view.message(error.message);}});
      host.querySelectorAll('[data-card-remove]').forEach(button=>button.onclick=()=>{try{removeCard(button.dataset.cardRemove);paint();}catch(error){view.message(error.message);}});
      await Promise.all(cards.map(async card=>{const node=[...host.querySelectorAll('[data-card]')].find(n=>n.dataset.card===card.id)?.querySelector('[data-card-content]');if(!node)return;try{const definition=card.type==='chart'?savedCharts().find(c=>c.id===card.chartId):null;if(card.type==='chart'&&!definition)throw new Error('The saved chart is unavailable.');const ref=await resolve(definition?.researchId||card.researchId);if(request!==generation||!view.overlay.isConnected)return;if(card.type==='chart'){const def=normalize(definition,ref.item,ref.result),data=buildDataset(def,ref.result),drawing=renderSVG(def,data);node.innerHTML=drawing.svg+`<button type="button" data-edit-chart>Open Chart Designer</button>`;node.querySelector('[data-edit-chart]').onclick=()=>open(ref.item,ref.result,definition);}else if(card.type==='table')node.innerHTML=tableHTML(ref.result,25);else{const kpi=resolveKPI(card,ref.result),row=kpi?.row,col=kpi?.column;node.innerHTML=row?`<strong class="asc-kpi-value">${escape(format(kpi.value,{decimals:ref.item.decimals,format:ref.item.showPercent?'percent':'number'}))}</strong><p>${escape(row.label)} · ${escape(col?.label||'Value')}</p><p class="asc-hint">Calculated result value. Open Research to refresh.</p>`:'<p>This exact result group or measure is missing or ambiguous. Pin a new KPI from Research.</p>';}}catch(error){if(request===generation)node.textContent=error.message||String(error);}}));
    }
    view.body.querySelector('[data-chart-search]').oninput=savedList;
    const file=view.body.querySelector('[data-import-file]');view.body.querySelector('[data-import-chart]').onclick=()=>file.click();file.onchange=async()=>{try{const upload=file.files[0];if(!upload)return;if(upload.size>1000000)throw new Error('Choose a chart configuration under 1 MB.');const parsed=JSON.parse(await upload.text());if(parsed.schemaVersion!==VERSION||!parsed.definition?.researchId)throw new Error('This is not a supported chart configuration.');saveDefinition({...parsed.definition,id:''});savedList();view.message('Chart imported. Open its referenced Research result to supply calculated data.');}catch(error){view.message(error.message);}file.value='';};
    view.onClose(()=>{generation++;});savedList();paint();return view;
  }
  const api={colorForIndex,linePreferences,lineLabelCandidates,weeklyMovingAverage,supportsViewer,viewerHTML,viewerSession,viewerDataset,calculationCaption,pointDescription,pointAverage,captureSurface,copyOrDownloadCapture,openViewer,captureViewer,version:VERSION,configure:options=>{adapters={...adapters,...options};},open,openForResearch,openSaved,openBoard,openComparison,compareGroups,register,resultActions,bind,recommend,normalize,buildDataset,renderSVG,format,toCSV,savedCharts,saveDefinition,boardCards,pinCard,moveCard,removeCard,resolveKPI,resultRowKey,resultColumnKey,stats,keys:{charts:CHARTS_KEY,board:BOARD_KEY,drafts:DRAFT_KEY}};
  root.AllStarCharts=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
