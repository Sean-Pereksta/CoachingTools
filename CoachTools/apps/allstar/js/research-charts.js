/* Independent chart definitions and an additive analysis board. Uses calculated
 * Research results only: chart edits and exports never execute a Research query.
 * Classic script + dependency-free SVG keep local and portable builds offline. */
(function(root){
  'use strict';
  const VERSION=1, CHARTS_KEY='allstar.researchCharts.v1', BOARD_KEY='allstar.analysisBoard.v1', DRAFT_KEY='allstar.chartDrafts.v1';
  const TYPES=['line','multi-line','bar','grouped-bar','stacked-bar','area','scatter','bubble','histogram','combo'];
  const COLORS=['#b91c1c','#2563eb','#059669','#d97706','#7c3aed','#0891b2','#db2777','#4d7c0f','#475569','#9f1239'];
  const references=new Map(), projections=new WeakMap(), draftMemory=new Map(), stats={datasetBuilds:0,datasetHits:0,renders:0};
  let adapters={}, sequence=0;
  const now=()=>root.performance?.now?.()??Date.now();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:(Number.isFinite(Number(value))?Number(value):null);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const makeId=prefix=>prefix+'-'+Date.now().toString(36)+'-'+(++sequence).toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const array=value=>Array.isArray(value)?value:[];
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
      average:!!def.average,trend:!!def.trend,target:finite(def.target),rolling:Math.max(0,Math.min(1000,Math.floor(Number(def.rolling)||0))),cumulative:!!def.cumulative,
      previous:!!def.previous,periodLag:Math.max(1,Math.min(1000,Math.floor(Number(def.periodLag)||1))),change:['none','difference','percent'].includes(def.change)?def.change:'none',
      bins:Math.max(2,Math.min(100,Math.floor(Number(def.bins)||10))),bubble,hiddenSeries,
      savedAt:String(def.savedAt||''),resultRenderedAt:String(result.renderedAt||item.renderedResult?.renderedAt||def.resultRenderedAt||'')
    };
  }
  function projectionKey(def){const keys=['type','x','y','secondary','panel','aggregation','sort','topN','include','exclude','start','end','rolling','cumulative','previous','periodLag','change','bins','bubble','average','trend','target'];return JSON.stringify(keys.map(k=>def[k]));}
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
      const label=String(row.label??''),date=finite(row.dateValue),text=label.toLocaleLowerCase();
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
        const point={categoryKey,label:category,x:numeric?x:null,value:finite(row.values?.[columnIndex]),radius:finite(def.bubble>=0?row.values?.[def.bubble]:row.rows),refs:[{rowIndex,columnIndex}],date:date??null};
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
    const analysis=[];
    for(const s of series){
      const byIndex=new Map(s.points.map(p=>[p.index,p]));
      if(!numeric)s.points=labels.map((label,i)=>byIndex.get(i)||({categoryKey:label.key,label:label.label,index:i,x:null,value:null,refs:[],date:label.date}));
      if(def.cumulative){let running=0;s.points=s.points.map(p=>({...p,value:p.value==null?null:(running+=p.value)}));}
      const original=s.points.map(p=>p.value);
      if(def.change!=='none')s.points=s.points.map((p,i)=>{const previous=original[i-def.periodLag],current=p.value;return {...p,value:previous==null||current==null?null:def.change==='percent'?(previous===0?null:(current-previous)/Math.abs(previous)*100):current-previous};});
      const derived=(suffix,values)=>analysis.push({id:s.id+'::'+suffix,name:s.name+' · '+suffix,columnIndex:s.columnIndex,derived:true,points:s.points.map((p,i)=>({...p,value:values[i],refs:[]}))});
      if(def.rolling>1)derived(def.rolling+'-point average',rolling(s.points.map(p=>p.value),def.rolling));
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
  function renderSVG(def,input,options={}){
    const started=now(),width=1000,height=460,left=86,right=30,top=30,bottom=90,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const hidden=new Set(def.hiddenSeries||[]),allVisible=input.series.filter(s=>!hidden.has(s.id)),visible=allVisible.slice(0,32),numeric=input.numeric;
    const stacked=def.type==='stacked-bar',bars=['bar','grouped-bar','stacked-bar','histogram','combo'].includes(def.type),colorFor=s=>COLORS[input.series.indexOf(s)%COLORS.length];
    const positive=new Array(input.labels.length).fill(0),negative=new Array(input.labels.length).fill(0),ys=[];
    for(const s of visible)for(const p of s.points)if(p.value!=null){if(stacked&&!s.derived){if(p.value>=0)positive[p.index]+=p.value;else negative[p.index]+=p.value;}else ys.push(p.value);}
    if(stacked){for(const value of positive)ys.push(value);for(const value of negative)ys.push(value);}
    const yr=bounds(ys);let min=Math.min(0,yr.min),max=Math.max(0,yr.max);if(min===max)max=min+1;
    const padding=(max-min)*.08;max+=padding;if(min<0)min-=padding;
    const xr=bounds(visible.flatMap(s=>s.points.map(p=>p.x))),xMin=xr.min,xMax=xr.max===xr.min?xr.max+1:xr.max;
    const y=value=>top+plotHeight-(value-min)/(max-min)*plotHeight,step=plotWidth/Math.max(1,input.labels.length),x=point=>numeric?left+(point.x-xMin)/(xMax-xMin)*plotWidth:left+step*(point.index+.5);
    const axisFormat=input.histogram?{...def,format:'number',decimals:0}:def.change==='percent'?{...def,format:'percent'}:def;
    let grid='',labels='',marks='';
    for(let i=0;i<=5;i++){const value=min+(max-min)*i/5,py=y(value);grid+=(def.grid?`<line x1="${left}" y1="${py}" x2="${width-right}" y2="${py}" stroke="#e2e8f0"/>`:'')+`<text x="${left-9}" y="${py+4}" text-anchor="end" font-size="12" fill="#475569">${escape(format(value,axisFormat))}</text>`;}
    if(numeric){for(let i=0;i<=5;i++){const value=xMin+(xMax-xMin)*i/5;labels+=`<text x="${left+plotWidth*i/5}" y="${height-bottom+23}" text-anchor="middle" font-size="12" fill="#475569">${escape(value.toLocaleString(undefined,{maximumFractionDigits:2}))}</text>`;}}
    else {const every=Math.max(1,Math.ceil(input.labels.length/12));input.labels.forEach((label,i)=>{if(i%every!==0&&i!==input.labels.length-1)return;const px=left+step*(i+.5),short=label.label.length>23?label.label.slice(0,22)+'…':label.label;labels+=`<text x="${px}" y="${height-bottom+17}" transform="rotate(-25 ${px} ${height-bottom+17})" text-anchor="end" font-size="11" fill="#475569"><title>${escape(label.label)}</title>${escape(short)}</text>`;});}
    const barSeries=visible.filter((s,i)=>!s.derived&&bars&&(def.type!=='combo'||i===0)),barSlots=Math.max(1,barSeries.length),pos=new Array(input.labels.length).fill(0),neg=new Array(input.labels.length).fill(0);
    let clipped=false;const pointBudget=Math.min(1000,Math.max(50,Math.floor(2500/Math.max(1,visible.length))));
    const pointAttrs=(series,p,pi)=>`data-chart-series="${escape(series.id)}" data-chart-point="${pi}"${p.refs.length?' tabindex="0" role="button"':''} aria-label="${escape(series.name+'; '+p.label+'; '+format(p.value,axisFormat))}"`;
    for(const series of visible){
      const color=colorFor(series),isBar=barSeries.includes(series),stride=Math.max(1,Math.ceil(series.points.length/pointBudget)),shown=series.points.map((p,i)=>({p,i})).filter(({i})=>i%stride===0||i===series.points.length-1);if(stride>1)clipped=true;
      if(isBar){for(const {p,i} of shown){if(p.value==null)continue;const slot=barSeries.indexOf(series),bw=Math.max(.8,step*.78/(stacked?1:barSlots)),bx=left+p.index*step+step*.11+(stacked?0:slot*bw);let base=0;if(stacked){base=p.value>=0?pos[p.index]:neg[p.index];if(p.value>=0)pos[p.index]+=p.value;else neg[p.index]+=p.value;}const by=Math.min(y(base),y(base+p.value)),bh=Math.abs(y(base)-y(base+p.value));marks+=`<rect x="${bx}" y="${by}" width="${bw*.92}" height="${Math.max(.5,bh)}" rx="2" fill="${color}" ${pointAttrs(series,p,i)}><title>${escape(series.name+' · '+p.label+': '+format(p.value,axisFormat))}</title></rect>`;if(def.dataLabels&&series.points.length<=60)marks+=`<text x="${bx+bw/2}" y="${p.value>=0?by-5:by+bh+14}" text-anchor="middle" font-size="11" fill="${color}">${escape(format(p.value,axisFormat))}</text>`;}}
      else if(numeric&&!series.derived){for(const {p,i} of shown){if(p.value==null)continue;const radius=def.type==='bubble'?Math.max(3,Math.min(24,Math.sqrt(Math.max(0,p.radius??1))*2)):4;marks+=`<circle cx="${x(p)}" cy="${y(p.value)}" r="${radius}" fill="${color}" fill-opacity=".7" ${pointAttrs(series,p,i)}><title>${escape(series.name+' · '+p.label+': '+format(p.value,axisFormat)+(def.type==='bubble'?' · size '+(p.radius??1):''))}</title></circle>`;}}
      else{
        let path='',segment=[],segments=[];
        for(const {p,i} of shown){if(p.value==null){if(segment.length)segments.push(segment);segment=[];continue;}segment.push({p,i});}if(segment.length)segments.push(segment);
        for(const points of segments){path+='M '+points.map(({p})=>x(p)+','+y(p.value)).join(' L ')+' ';if((def.type==='area'||def.fill)&&!series.derived){const first=points[0].p,last=points[points.length-1].p;marks+=`<path d="M ${x(first)},${y(0)} L ${points.map(({p})=>x(p)+','+y(p.value)).join(' L ')} L ${x(last)},${y(0)} Z" fill="${color}" fill-opacity=".1"/>`;}}
        marks+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="${def.lineWidth}"${series.derived?' stroke-dasharray="7 5"':''}/>`;
        for(const {p,i} of shown){if(p.value==null)continue;marks+=`<circle cx="${x(p)}" cy="${y(p.value)}" r="${def.points?3.5:6}" fill="${color}" fill-opacity="${def.points?1:0}" ${pointAttrs(series,p,i)}><title>${escape(series.name+' · '+p.label+': '+format(p.value,axisFormat))}</title></circle>`;if(def.dataLabels&&series.points.length<=60)marks+=`<text x="${x(p)}" y="${y(p.value)-9}" text-anchor="middle" font-size="11" fill="${color}">${escape(format(p.value,axisFormat))}</text>`;}
      }
    }
    const summary=!visible.length?'All series are hidden. Restore a series with its legend button.':!visible.some(s=>s.points.some(p=>p.value!=null))?'No numeric values match these chart settings.':'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="asc-svg" role="img" aria-label="${escape(def.title||'Research chart')}"><title>${escape(def.title)}</title><desc>${escape(summary||input.series.length+' series. Use the table or focus a data point to inspect its values.')}</desc><rect width="1000" height="460" fill="#fff"/>${grid}<line x1="${left}" y1="${y(0)}" x2="${width-right}" y2="${y(0)}" stroke="#94a3b8"/>${labels}${marks}${summary?`<text x="500" y="210" text-anchor="middle" fill="#475569" font-size="17">${escape(summary)}</text>`:''}<text x="${left+plotWidth/2}" y="${height-7}" text-anchor="middle" font-size="13" fill="#334155">${escape(def.xLabel)}</text><text transform="translate(16 ${top+plotHeight/2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#334155">${escape(def.yLabel||(input.histogram?'Count of result values':''))}</text></svg>`;
    stats.renders++;adapters.onTiming?.('chartRender',now()-started,'render only');
    return {svg,clipped,seriesClipped:allVisible.length>32,legend:input.series.map(s=>({id:s.id,name:s.name,color:colorFor(s),hidden:hidden.has(s.id)}))};
  }
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
    scope.querySelectorAll('[data-asc-open]').forEach(button=>button.onclick=()=>openForResearch(button.dataset.ascOpen).catch(reportError));
    scope.querySelectorAll('[data-asc-compare]').forEach(button=>button.onclick=async()=>{try{const ref=await resolve(button.dataset.ascCompare);openComparison(ref.item,ref.result);}catch(error){reportError(error);}});
    scope.querySelectorAll('[data-asc-pin]').forEach(button=>button.onclick=async()=>{try{const ref=await resolve(button.dataset.ascPin);if(button.dataset.ascKind==='kpi'){openKpiPicker(ref.item,ref.result);return;}pinCard({type:'table',researchId:ref.item.id,title:ref.item.title});button.textContent='Pinned to Board';}catch(error){reportError(error);}});
  }
  function reportError(error){if(adapters.onError)adapters.onError(error);else root.alert?.(error.message||String(error));}
  function dialog(title,className=''){
    const doc=root.document,prior=doc.activeElement,overlay=doc.createElement('div');overlay.className='asc-overlay '+className;overlay.innerHTML=`<section class="asc-dialog" role="dialog" aria-modal="true" aria-label="${escape(title)}"><header class="asc-dialog-head"><h2>${escape(title)}</h2><button type="button" data-asc-close aria-label="Close ${escape(title)}">Close</button></header><div class="asc-dialog-content"></div><div class="asc-message" role="status" aria-live="polite"></div></section>`;doc.body.appendChild(overlay);
    let onClose=()=>{};const close=()=>{onClose();overlay.remove();if(prior?.isConnected)prior.focus();};overlay.querySelector('[data-asc-close]').onclick=close;
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
      <details><summary>Appearance</summary>${inputField('title','Title',def.title)}${inputField('subtitle','Subtitle',def.subtitle)}${inputField('xLabel','X axis label',def.xLabel)}${inputField('yLabel','Y axis label',def.yLabel)}${selectField('format','Number format',[['number','Number'],['percent','Percent: 52 → 52%'],['decimal_percent','Decimal percent: 0.52 → 52%'],['currency','Currency ($)']],def.format)}${inputField('decimals','Decimal places',def.decimals,'number','min="0" max="6"')}${inputField('lineWidth','Line thickness',def.lineWidth,'range','min="1" max="8"')}${checkField('legend','Legend',def.legend)}${checkField('dataLabels','Data labels (up to 60 points)',def.dataLabels)}${checkField('grid','Gridlines',def.grid)}${checkField('points','Point markers',def.points)}${checkField('fill','Area fill',def.fill)}</details>
      <details><summary>Analysis</summary><p class="asc-hint">Uses the calculated result in displayed order. A point represents one result period/group; rates remain in their original scale.</p>${checkField('average','Average reference lines',def.average)}${checkField('trend','Linear trend lines',def.trend)}${inputField('target','Target (original value scale)',def.target,'number','step="any"')}${inputField('rolling','Moving average window (0 = off)',def.rolling,'number','min="0" max="1000"')}${checkField('cumulative','Cumulative values',def.cumulative)}${checkField('previous','Previous-period overlay',def.previous)}${inputField('periodLag','Previous period distance (points)',def.periodLag,'number','min="1" max="1000"')}${selectField('change','Period change',[['none','Original values'],['difference','Difference from previous period'],['percent','Percent change from previous period']],def.change)}</details>`;
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
    view.body.querySelectorAll('[data-export]').forEach(button=>button.onclick=async()=>{try{const kind=button.dataset.export,name=safeFilename(def.title);if(kind==='csv')download(name+'.csv',toCSV(data),'text/csv;charset=utf-8');else if(kind==='json')download(name+'.json',JSON.stringify({schemaVersion:VERSION,definition:def},null,2),'application/json');else if(kind==='svg')download(name+'.svg',rendered.svg,'image/svg+xml');else if(kind==='xlsx'){if(!root.XLSX?.utils)throw new Error('Excel export is unavailable in this build. Export CSV instead.');const workbook=root.XLSX.utils.book_new();root.XLSX.utils.book_append_sheet(workbook,root.XLSX.utils.aoa_to_sheet(dataRows(data)),'Chart Data');root.XLSX.writeFile(workbook,name+'.xlsx');}else if(kind==='copy'){if(!root.navigator?.clipboard?.writeText)throw new Error('Clipboard access is unavailable here. Export CSV instead.');await root.navigator.clipboard.writeText(dataRows(data).map(row=>row.map(v=>String(v??'').replace(/[\t\r\n]+/g,' ')).join('\t')).join('\n'));view.message('Chart data copied.');}else{const blob=await imageBlob(rendered.svg);if(kind==='png')download(name+'.png',blob,'image/png');else{if(!root.navigator?.clipboard?.write||!root.ClipboardItem)throw new Error('Image clipboard is unavailable here. Export PNG instead.');await root.navigator.clipboard.write([new root.ClipboardItem({'image/png':blob})]);view.message('Chart copied.');}}}catch(error){view.message(error.message||String(error));}});
    view.onClose(()=>{if(JSON.stringify(def)!==savedJSON||!def.id)try{writeDraft(item.id,def);}catch(error){reportError(new Error('Your unsaved chart draft is kept for this session, but browser storage could not save it. Reopen Chart Designer and export its configuration to keep it after closing this browser.'));}});
    bindControls();paint();return view;
  }
  function imageBlob(svg){return new Promise((resolve,reject)=>{const url=root.URL.createObjectURL(new root.Blob([svg],{type:'image/svg+xml'})),image=new root.Image();image.onload=()=>{const canvas=root.document.createElement('canvas');canvas.width=2000;canvas.height=920;canvas.getContext('2d').drawImage(image,0,0,2000,920);root.URL.revokeObjectURL(url);canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Image export failed. Try SVG.')),'image/png');};image.onerror=()=>{root.URL.revokeObjectURL(url);reject(new Error('Image export failed. Try SVG.'));};image.src=url;});}
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
  const api={version:VERSION,configure:options=>{adapters={...adapters,...options};},open,openForResearch,openSaved,openBoard,openComparison,compareGroups,register,resultActions,bind,recommend,normalize,buildDataset,renderSVG,format,toCSV,savedCharts,saveDefinition,boardCards,pinCard,moveCard,removeCard,resolveKPI,resultRowKey,resultColumnKey,stats,keys:{charts:CHARTS_KEY,board:BOARD_KEY,drafts:DRAFT_KEY}};
  root.AllStarCharts=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
